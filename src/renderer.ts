/**
 * UltrafastRenderer — WebGL2 Triple-Buffered Canvas 2D Renderer
 *
 * A standalone WebGL-accelerated Canvas 2D rendering engine. Provides a
 * CanvasAPI for recording draw commands and a triple-buffered FBO pipeline
 * that displays them via a passthrough shader at vsync rate.
 *
 * Triple buffer scheme (all on main thread, lock-free via JS single-threading):
 *
 *   Content submission:
 *     submitBatch(commands)
 *       → bind writeFBO
 *       → Canvas2DShim executes commands as WebGL draw calls
 *       → swap: writeFBO ↔ readyFBO
 *
 *   Display loop (vsync rate via RAF):
 *     RAF callback
 *       → auto-flush: drain CanvasAPI commands → submitBatch
 *       → bind default framebuffer (display canvas)
 *       → read readyFBO texture → passthrough blit → screen
 *
 * Extension points for downstream consumers (e.g. maalata CRT display):
 *   - getGL(): access the WebGL2 context
 *   - getReadyTexture(): read the latest rendered frame as a texture
 *   - stopDisplay() / startDisplay(): take over the display loop
 */

import { CanvasAPI, type CanvasCommand } from './canvas-api';
import { Canvas2DShim } from './canvas2d-shim';
import {
  PASSTHROUGH_VERTEX_SRC,
  PASSTHROUGH_FRAGMENT_SRC,
} from './shaders';

interface _FBO {
  _fbo: WebGLFramebuffer;
  _texture: WebGLTexture;
}

export class UltrafastRenderer {
  private _gl: WebGL2RenderingContext;
  private _canvas: HTMLCanvasElement;
  private _shim: Canvas2DShim;
  private _api: CanvasAPI;
  private _rafId: number | null = null;

  // Triple buffer: three FBOs with color texture attachments
  private _fbos!: [_FBO, _FBO, _FBO];
  private _writeIdx = 0;
  private _readyIdx = 1;
  private _displayIdx = 2;
  private _hasContent = false;

  // Background color for opaque canvas clear (default: black, backwards compatible)
  private _bgColor = new Float32Array([0, 0, 0]);

  // Display program
  private _passthroughProgram: WebGLProgram;

  // Fullscreen quad VBO
  private _quadVBO!: WebGLBuffer;
  private _quadPositionLoc = -1;

  constructor(canvas: HTMLCanvasElement) {
    this._canvas = canvas;
    this._api = new CanvasAPI();

    // Create WebGL2 context with optimizations
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      desynchronized: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      throw new Error('WebGL2 not supported');
    }
    this._gl = gl;

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

    // Initialize triple buffer FBOs
    this._initFBOs();

    // Initialize Canvas 2D shim (uses same GL context)
    this._shim = new Canvas2DShim(gl, canvas.width, canvas.height);

    // Initialize passthrough display program
    this._passthroughProgram = this._createShaderProgram(
      PASSTHROUGH_VERTEX_SRC, PASSTHROUGH_FRAGMENT_SRC
    );

    // Initialize fullscreen quad VBO for display pass
    this._initQuadVBO();

    // Clear all FBOs to black initially
    this._clearAllFBOs();

    // Auto-start display loop
    this.startDisplay();
  }

  // -------------------------------------------------------------------------
  // Public API (no _ prefix: cross-file access safe from mangleProps)
  // -------------------------------------------------------------------------

  /** Get the CanvasAPI for recording draw commands. */
  getCanvasAPI(): CanvasAPI {
    return this._api;
  }

  /**
   * Submit a batch of Canvas 2D commands to be rendered into the write FBO.
   * After rendering, the write and ready FBOs are swapped so the display
   * loop picks up the latest frame.
   */
  submitBatch(commands: CanvasCommand[]): void {
    if (commands.length === 0) return;
    const gl = this._gl;

    // Bind write FBO as render target
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbos[this._writeIdx]._fbo);
    gl.viewport(0, 0, this._canvas.width, this._canvas.height);

    // Execute Canvas 2D commands as WebGL draw calls
    this._shim.executeBatch(commands);

    // Swap write ↔ ready (new frame becomes available for display)
    const tmp = this._writeIdx;
    this._writeIdx = this._readyIdx;
    this._readyIdx = tmp;
    this._hasContent = true;
  }

  /** Start the passthrough RAF display loop with auto-flush. */
  startDisplay(): void {
    if (this._rafId !== null) return;
    this._displayLoop();
  }

  /** Stop the passthrough RAF display loop. Last frame persists (preserveDrawingBuffer). */
  stopDisplay(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  /** Returns the display canvas element. */
  getCanvas(): HTMLCanvasElement {
    return this._canvas;
  }

  /** Get canvas dimensions. */
  getCanvasSize(): { width: number; height: number } {
    return { width: this._canvas.width, height: this._canvas.height };
  }

  /** Capture the current displayed frame as an ImageBitmap. */
  screenshot(): Promise<ImageBitmap> {
    this._renderDisplay();
    return createImageBitmap(this._canvas);
  }

  /**
   * Set the opaque clear color used by clearRect and FBO initialization.
   * With alpha: false, cleared areas are opaque — this controls what color
   * they appear as instead of black. Values are in [0, 1] range.
   */
  setBackgroundColor(r: number, g: number, b: number): void {
    this._bgColor[0] = r;
    this._bgColor[1] = g;
    this._bgColor[2] = b;
    this._shim.setBackgroundColor(r, g, b);
  }

  /** Clean up all WebGL resources. */
  destroy(): void {
    this.stopDisplay();
    const gl = this._gl;

    this._shim.destroy();

    for (const fbo of this._fbos) {
      gl.deleteFramebuffer(fbo._fbo);
      gl.deleteTexture(fbo._texture);
    }

    gl.deleteProgram(this._passthroughProgram);
    gl.deleteBuffer(this._quadVBO);

    const ext = gl.getExtension('WEBGL_lose_context');
    if (ext) ext.loseContext();
  }

  // -------------------------------------------------------------------------
  // Extension points (used by maalata CRT display)
  // -------------------------------------------------------------------------

  /** Returns the WebGL2 context for external rendering (e.g. CRT shader). */
  getGL(): WebGL2RenderingContext {
    return this._gl;
  }

  /** Returns the ready FBO's texture — the latest fully rendered frame. */
  getReadyTexture(): WebGLTexture {
    return this._fbos[this._readyIdx]._texture;
  }

  // -------------------------------------------------------------------------
  // Private: display loop
  // -------------------------------------------------------------------------

  private _displayLoop(): void {
    this._rafId = requestAnimationFrame(() => this._displayLoop());

    // Auto-flush: drain any pending CanvasAPI commands into the pipeline
    const cmds = this._api.takeCommands();
    if (cmds.length) this.submitBatch(cmds);

    this._renderDisplay();
  }

  /**
   * Render the ready FBO to the display canvas via passthrough shader.
   * Called at vsync rate by RAF, or once synchronously for screenshots.
   */
  private _renderDisplay(): void {
    if (!this._hasContent) return;

    const gl = this._gl;

    // Bind default framebuffer (display canvas backbuffer)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this._canvas.width, this._canvas.height);

    // Bind the ready FBO's texture as input
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._fbos[this._readyIdx]._texture);

    gl.useProgram(this._passthroughProgram);

    // Draw fullscreen quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadVBO);
    gl.enableVertexAttribArray(this._quadPositionLoc);
    gl.vertexAttribPointer(this._quadPositionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.enable(gl.BLEND);
  }

  // -------------------------------------------------------------------------
  // Private: initialization
  // -------------------------------------------------------------------------

  private _initFBOs(): void {
    this._fbos = [
      this._createFBO(),
      this._createFBO(),
      this._createFBO(),
    ];
  }

  private _createFBO(): _FBO {
    const gl = this._gl;
    const w = this._canvas.width;
    const h = this._canvas.height;

    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { _fbo: fbo, _texture: texture };
  }

  private _clearAllFBOs(): void {
    const gl = this._gl;
    const bg = this._bgColor;
    for (const fbo of this._fbos) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo._fbo);
      gl.clearColor(bg[0], bg[1], bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  private _initQuadVBO(): void {
    const gl = this._gl;

    this._quadVBO = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 0,  1, 0,  0, 1,
      0, 1,  1, 0,  1, 1,
    ]), gl.STATIC_DRAW);

    this._quadPositionLoc = gl.getAttribLocation(this._passthroughProgram, 'a_position');
  }

  // -------------------------------------------------------------------------
  // Private: shader helpers
  // -------------------------------------------------------------------------

  private _createShaderProgram(vSrc: string, fSrc: string): WebGLProgram {
    const gl = this._gl;
    const vs = this._compileShader(gl.VERTEX_SHADER, vSrc);
    const fs = this._compileShader(gl.FRAGMENT_SHADER, fSrc);

    const program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error('Shader link failed: ' + gl.getProgramInfoLog(program));
    }

    gl.deleteShader(vs);
    gl.deleteShader(fs);

    return program;
  }

  private _compileShader(type: number, source: string): WebGLShader {
    const gl = this._gl;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Shader compile failed: ' + info);
    }
    return shader;
  }
}
