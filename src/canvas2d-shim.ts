/**
 * Canvas 2D → WebGL Command Shim
 *
 * Translates CanvasCommand[] (recorded by CanvasAPI) into WebGL draw calls.
 * Handles the subset of Canvas 2D API used by the demo, plus reasonable
 * extensions. Operations not yet implemented log a warning and no-op.
 *
 * Rendering approach per command type:
 * - clearRect:  gl.scissor + gl.clear
 * - fillRect:   unit quad VBO + flat shader + transform uniform
 * - strokeRect: four thin quads (one per edge)
 * - fillText:   render to OffscreenCanvas 2D → texImage2D → textured quad
 * - stroke():   expand line segments to quads on CPU, flat shader
 * - save/restore: matrix + state stack
 *
 * Text rendering uses an OffscreenCanvas with a 2D context as a glyph
 * rendering surface. At 8 FPS with ~5 text draws per frame, per-string
 * rendering (not glyph caching) is appropriate — texImage2D(OffscreenCanvas)
 * is a fast GPU upload path.
 */

import { CanvasCommand } from './canvas-api';
import { MatrixStack } from './matrix-stack';
import { parseColor } from './color-parser';
import {
  FLAT_VERTEX_SRC, FLAT_FRAGMENT_SRC,
  TEXTURED_VERTEX_SRC, TEXTURED_FRAGMENT_SRC,
} from './shaders';

interface _DrawState {
  _fillColor: Float32Array;
  _strokeColor: Float32Array;
  _lineWidth: number;
  _globalAlpha: number;
  _font: string;
  _textAlign: CanvasTextAlign;
  _textBaseline: CanvasTextBaseline;
  _lineCap: CanvasLineCap;
  _lineJoin: CanvasLineJoin;
}

interface _ProgramInfo {
  _program: WebGLProgram;
  _matrixLoc: WebGLUniformLocation | null;
  _colorLoc: WebGLUniformLocation | null;
  _textureLoc: WebGLUniformLocation | null;
  _positionLoc: number;
  _texCoordLoc: number;
}

export class Canvas2DShim {
  private _gl: WebGLRenderingContext;
  private _width: number;
  private _height: number;

  // Transform
  private _matrix: MatrixStack;

  // State
  private _fillColor: Float32Array = new Float32Array([0, 0, 0, 1]);
  private _strokeColor: Float32Array = new Float32Array([0, 0, 0, 1]);
  private _lineWidth = 1;
  private _globalAlpha = 1;
  private _font = '10px sans-serif';
  private _textAlign: CanvasTextAlign = 'start';
  private _textBaseline: CanvasTextBaseline = 'alphabetic';
  private _lineCap: CanvasLineCap = 'butt';
  private _lineJoin: CanvasLineJoin = 'miter';
  private _stateStack: _DrawState[] = [];

  // Path state
  private _pathSegments: number[] = []; // flat: x0,y0,x1,y1,...
  private _currentX = 0;
  private _currentY = 0;
  private _subpathStartX = 0;
  private _subpathStartY = 0;

  // WebGL resources
  private _flat: _ProgramInfo;
  private _textured: _ProgramInfo;
  private _unitQuadVBO: WebGLBuffer;
  private _dynamicVBO: WebGLBuffer;
  private _texturedVBO: WebGLBuffer;
  private _textTexture: WebGLTexture;

  // Text rendering surface
  private _textCanvas: OffscreenCanvas;
  private _textCtx: OffscreenCanvasRenderingContext2D;

  // Temp arrays to avoid allocation in hot path
  private _tmpColor = new Float32Array(4);

  constructor(gl: WebGLRenderingContext, width: number, height: number) {
    this._gl = gl;
    this._width = width;
    this._height = height;
    this._matrix = new MatrixStack(width, height);

    // Compile shader programs
    this._flat = this._createProgram(
      FLAT_VERTEX_SRC, FLAT_FRAGMENT_SRC, false
    );
    this._textured = this._createProgram(
      TEXTURED_VERTEX_SRC, TEXTURED_FRAGMENT_SRC, true
    );

    // Unit quad VBO: two triangles covering [0,0]-[1,1]
    // Used for fillRect (scaled via matrix) and fullscreen blits
    this._unitQuadVBO = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._unitQuadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 0,  1, 0,  0, 1,
      0, 1,  1, 0,  1, 1,
    ]), gl.STATIC_DRAW);

    // Dynamic VBO for line quads — uses orphaning for double-buffer
    this._dynamicVBO = gl.createBuffer()!;

    // Textured quad VBO: position + texcoord interleaved
    this._texturedVBO = gl.createBuffer()!;

    // Text rendering texture
    this._textTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this._textTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // OffscreenCanvas for text glyph rendering
    this._textCanvas = new OffscreenCanvas(512, 128);
    this._textCtx = this._textCanvas.getContext('2d')!;

    // Enable blending for standard source-over compositing
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Execute a batch of Canvas 2D commands as WebGL draw calls.
   * No _ prefix: called cross-file from webgl-renderer.
   */
  executeBatch(commands: CanvasCommand[]): void {
    for (const cmd of commands) {
      if (cmd.type === 'property') {
        this._setProperty(cmd.name, cmd.value);
      } else {
        this._callMethod(cmd.name, cmd.args);
      }
    }
  }

  /**
   * Update canvas dimensions on resize.
   * No _ prefix: called cross-file.
   */
  resize(width: number, height: number): void {
    this._width = width;
    this._height = height;
    this._matrix.resize(width, height);
  }

  /**
   * Clean up WebGL resources.
   * No _ prefix: called cross-file.
   */
  destroy(): void {
    const gl = this._gl;
    gl.deleteBuffer(this._unitQuadVBO);
    gl.deleteBuffer(this._dynamicVBO);
    gl.deleteBuffer(this._texturedVBO);
    gl.deleteTexture(this._textTexture);
    gl.deleteProgram(this._flat._program);
    gl.deleteProgram(this._textured._program);
  }

  // -------------------------------------------------------------------------
  // Private: property handling
  // -------------------------------------------------------------------------

  private _setProperty(name: string, value: unknown): void {
    switch (name) {
      case 'fillStyle':
        this._fillColor = parseColor(value as string);
        break;
      case 'strokeStyle':
        this._strokeColor = parseColor(value as string);
        break;
      case 'lineWidth':
        this._lineWidth = value as number;
        break;
      case 'globalAlpha':
        this._globalAlpha = value as number;
        break;
      case 'font':
        this._font = value as string;
        break;
      case 'textAlign':
        this._textAlign = value as CanvasTextAlign;
        break;
      case 'textBaseline':
        this._textBaseline = value as CanvasTextBaseline;
        break;
      case 'lineCap':
        this._lineCap = value as CanvasLineCap;
        break;
      case 'lineJoin':
        this._lineJoin = value as CanvasLineJoin;
        break;
      default:
        // Unsupported properties: silently ignore
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Private: method dispatch
  // -------------------------------------------------------------------------

  private _callMethod(name: string, args: unknown[]): void {
    switch (name) {
      // Rectangles
      case 'clearRect':
        this._clearRect(args[0] as number, args[1] as number, args[2] as number, args[3] as number);
        break;
      case 'fillRect':
        this._fillRect(args[0] as number, args[1] as number, args[2] as number, args[3] as number);
        break;
      case 'strokeRect':
        this._strokeRect(args[0] as number, args[1] as number, args[2] as number, args[3] as number);
        break;

      // Text
      case 'fillText':
        this._fillText(args[0] as string, args[1] as number, args[2] as number);
        break;
      case 'strokeText':
        this._strokeText(args[0] as string, args[1] as number, args[2] as number);
        break;

      // Path
      case 'beginPath':
        this._pathSegments = [];
        break;
      case 'closePath':
        if (this._currentX !== this._subpathStartX || this._currentY !== this._subpathStartY) {
          this._pathSegments.push(
            this._currentX, this._currentY,
            this._subpathStartX, this._subpathStartY
          );
          this._currentX = this._subpathStartX;
          this._currentY = this._subpathStartY;
        }
        break;
      case 'moveTo':
        this._currentX = this._subpathStartX = args[0] as number;
        this._currentY = this._subpathStartY = args[1] as number;
        break;
      case 'lineTo': {
        const x = args[0] as number;
        const y = args[1] as number;
        this._pathSegments.push(this._currentX, this._currentY, x, y);
        this._currentX = x;
        this._currentY = y;
        break;
      }
      case 'stroke':
        this._strokePath();
        break;
      case 'fill':
        // Convex fill only — not heavily used in demo beyond fillRect
        break;

      // State
      case 'save':
        this._save();
        break;
      case 'restore':
        this._restore();
        break;

      // Transforms
      case 'translate':
        this._matrix.translate(args[0] as number, args[1] as number);
        break;
      case 'rotate':
        this._matrix.rotate(args[0] as number);
        break;
      case 'scale':
        this._matrix.scale(args[0] as number, args[1] as number);
        break;
      case 'transform':
        this._matrix.transform(
          args[0] as number, args[1] as number, args[2] as number,
          args[3] as number, args[4] as number, args[5] as number
        );
        break;
      case 'setTransform':
        this._matrix.setTransform(
          args[0] as number, args[1] as number, args[2] as number,
          args[3] as number, args[4] as number, args[5] as number
        );
        break;
      case 'resetTransform':
        this._matrix.resetTransform();
        break;

      default:
        // Unsupported methods: silently ignore (arc, bezierCurveTo, etc.)
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Private: drawing operations
  // -------------------------------------------------------------------------

  private _clearRect(x: number, y: number, w: number, h: number): void {
    const gl = this._gl;
    // WebGL scissor uses bottom-left origin, canvas uses top-left
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(x, this._height - y - h, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
  }

  private _fillRect(x: number, y: number, w: number, h: number): void {
    const gl = this._gl;
    const prog = this._flat;

    gl.useProgram(prog._program);

    // Build transform: current matrix × translate(x,y) × scale(w,h)
    // Applied to unit quad [0,1]×[0,1] → fills [x,y,x+w,y+h]
    this._matrix.save();
    this._matrix.translate(x, y);
    this._matrix.scale(w, h);

    gl.uniformMatrix3fv(prog._matrixLoc, false, this._matrix.getMatrix());
    this._setColorUniform(prog._colorLoc!, this._fillColor, this._globalAlpha);

    this._matrix.restore();

    // Draw unit quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this._unitQuadVBO);
    gl.enableVertexAttribArray(prog._positionLoc);
    gl.vertexAttribPointer(prog._positionLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private _strokeRect(x: number, y: number, w: number, h: number): void {
    // Draw four edges as thin quads
    const lw = this._lineWidth;
    const hlw = lw / 2;

    // Top edge
    this._fillRectWithColor(x - hlw, y - hlw, w + lw, lw, this._strokeColor);
    // Bottom edge
    this._fillRectWithColor(x - hlw, y + h - hlw, w + lw, lw, this._strokeColor);
    // Left edge
    this._fillRectWithColor(x - hlw, y + hlw, lw, h - lw, this._strokeColor);
    // Right edge
    this._fillRectWithColor(x + w - hlw, y + hlw, lw, h - lw, this._strokeColor);
  }

  /** Internal: draw a filled rect with a specific color (used by strokeRect). */
  private _fillRectWithColor(x: number, y: number, w: number, h: number, color: Float32Array): void {
    const gl = this._gl;
    const prog = this._flat;

    gl.useProgram(prog._program);

    this._matrix.save();
    this._matrix.translate(x, y);
    this._matrix.scale(w, h);

    gl.uniformMatrix3fv(prog._matrixLoc, false, this._matrix.getMatrix());
    this._setColorUniform(prog._colorLoc!, color, this._globalAlpha);

    this._matrix.restore();

    gl.bindBuffer(gl.ARRAY_BUFFER, this._unitQuadVBO);
    gl.enableVertexAttribArray(prog._positionLoc);
    gl.vertexAttribPointer(prog._positionLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private _strokePath(): void {
    const segs = this._pathSegments;
    if (segs.length === 0) return;

    const gl = this._gl;
    const prog = this._flat;
    const halfW = Math.max(this._lineWidth / 2, 0.5);

    // Expand line segments to quads on CPU
    // Each segment (x0,y0,x1,y1) → 6 vertices (2 triangles)
    const segCount = segs.length / 4;
    const vertices = new Float32Array(segCount * 12); // 6 vertices × 2 coords

    for (let i = 0, vi = 0; i < segs.length; i += 4) {
      const x0 = segs[i], y0 = segs[i + 1], x1 = segs[i + 2], y1 = segs[i + 3];
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.sqrt(dx * dx + dy * dy);

      if (len < 0.001) continue; // Skip degenerate segments

      // Normal perpendicular to line direction
      const nx = (-dy / len) * halfW;
      const ny = (dx / len) * halfW;

      // Four corners of the quad
      const ax = x0 + nx, ay = y0 + ny; // top-left
      const bx = x0 - nx, by = y0 - ny; // bottom-left
      const cx = x1 + nx, cy = y1 + ny; // top-right
      const dx2 = x1 - nx, dy2 = y1 - ny; // bottom-right

      // Triangle 1: A, B, C
      vertices[vi++] = ax; vertices[vi++] = ay;
      vertices[vi++] = bx; vertices[vi++] = by;
      vertices[vi++] = cx; vertices[vi++] = cy;
      // Triangle 2: B, D, C
      vertices[vi++] = bx; vertices[vi++] = by;
      vertices[vi++] = dx2; vertices[vi++] = dy2;
      vertices[vi++] = cx; vertices[vi++] = cy;
    }

    // Upload to dynamic VBO using orphaning (bufferData null pattern)
    gl.bindBuffer(gl.ARRAY_BUFFER, this._dynamicVBO);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);

    gl.useProgram(prog._program);
    gl.uniformMatrix3fv(prog._matrixLoc, false, this._matrix.getMatrix());
    this._setColorUniform(prog._colorLoc!, this._strokeColor, this._globalAlpha);

    gl.enableVertexAttribArray(prog._positionLoc);
    gl.vertexAttribPointer(prog._positionLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, segCount * 6);
  }

  private _fillText(text: string, x: number, y: number): void {
    this._renderText(text, x, y, 'fill');
  }

  private _strokeText(text: string, x: number, y: number): void {
    this._renderText(text, x, y, 'stroke');
  }

  private _renderText(text: string, x: number, y: number, mode: 'fill' | 'stroke'): void {
    const gl = this._gl;
    const tCtx = this._textCtx;

    // Configure text rendering context
    tCtx.font = this._font;
    tCtx.textAlign = 'left'; // Always render left-aligned, position via WebGL
    tCtx.textBaseline = 'top'; // Always render from top, adjust Y via offset

    // Measure text
    const metrics = tCtx.measureText(text);
    const textWidth = Math.ceil(metrics.width) + 4; // +4 for antialiasing padding
    const fontSize = _parseFontSize(this._font);
    const textHeight = Math.ceil(fontSize * 1.5) + 4; // approximate height with descenders

    if (textWidth <= 0 || textHeight <= 0) return;

    // Resize text canvas if needed
    if (this._textCanvas.width < textWidth || this._textCanvas.height < textHeight) {
      this._textCanvas.width = Math.max(this._textCanvas.width, textWidth);
      this._textCanvas.height = Math.max(this._textCanvas.height, textHeight);
      // Re-set font after resize (context is reset)
      tCtx.font = this._font;
      tCtx.textAlign = 'left';
      tCtx.textBaseline = 'top';
    }

    // Clear and render text
    tCtx.clearRect(0, 0, this._textCanvas.width, this._textCanvas.height);

    if (mode === 'fill') {
      tCtx.fillStyle = 'white'; // White text, tinted by WebGL uniform
      tCtx.fillText(text, 2, 2); // +2 padding offset
    } else {
      tCtx.strokeStyle = 'white';
      tCtx.lineWidth = this._lineWidth;
      tCtx.strokeText(text, 2, 2);
    }

    // Upload text canvas to texture
    gl.bindTexture(gl.TEXTURE_2D, this._textTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
      this._textCanvas
    );
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

    // Compute text position adjustments
    const color = mode === 'fill' ? this._fillColor : this._strokeColor;
    let drawX = x - 2; // compensate for padding
    let drawY = y - 2;

    // Adjust for textAlign
    switch (this._textAlign) {
      case 'center': drawX -= textWidth / 2; break;
      case 'right':
      case 'end':    drawX -= textWidth; break;
    }

    // Adjust for textBaseline
    switch (this._textBaseline) {
      case 'top':         /* drawY stays */ break;
      case 'middle':      drawY -= textHeight / 2; break;
      case 'alphabetic':
      case 'ideographic': drawY -= fontSize; break;
      case 'bottom':
      case 'hanging':     drawY -= textHeight; break;
    }

    // Draw textured quad
    this._drawTexturedQuad(
      drawX, drawY, textWidth, textHeight,
      textWidth / this._textCanvas.width,
      textHeight / this._textCanvas.height,
      color
    );
  }

  private _drawTexturedQuad(
    x: number, y: number, w: number, h: number,
    uMax: number, vMax: number,
    color: Float32Array
  ): void {
    const gl = this._gl;
    const prog = this._textured;

    // Interleaved position + texcoord (x, y, u, v)
    const verts = new Float32Array([
      x,     y,      0,    0,
      x + w, y,      uMax, 0,
      x,     y + h,  0,    vMax,
      x,     y + h,  0,    vMax,
      x + w, y,      uMax, 0,
      x + w, y + h,  uMax, vMax,
    ]);

    gl.bindBuffer(gl.ARRAY_BUFFER, this._texturedVBO);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);

    gl.useProgram(prog._program);
    gl.uniformMatrix3fv(prog._matrixLoc, false, this._matrix.getMatrix());
    this._setColorUniform(prog._colorLoc!, color, this._globalAlpha);

    // Use premultiplied alpha blending for text
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const stride = 16; // 4 floats × 4 bytes
    gl.enableVertexAttribArray(prog._positionLoc);
    gl.vertexAttribPointer(prog._positionLoc, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(prog._texCoordLoc);
    gl.vertexAttribPointer(prog._texCoordLoc, 2, gl.FLOAT, false, stride, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._textTexture);
    gl.uniform1i(prog._textureLoc, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // Restore standard blending
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Disable texcoord attrib to avoid interfering with flat shader
    gl.disableVertexAttribArray(prog._texCoordLoc);
  }

  // -------------------------------------------------------------------------
  // Private: state management
  // -------------------------------------------------------------------------

  private _save(): void {
    this._matrix.save();
    this._stateStack.push({
      _fillColor: new Float32Array(this._fillColor),
      _strokeColor: new Float32Array(this._strokeColor),
      _lineWidth: this._lineWidth,
      _globalAlpha: this._globalAlpha,
      _font: this._font,
      _textAlign: this._textAlign,
      _textBaseline: this._textBaseline,
      _lineCap: this._lineCap,
      _lineJoin: this._lineJoin,
    });
  }

  private _restore(): void {
    this._matrix.restore();
    const state = this._stateStack.pop();
    if (state) {
      this._fillColor = state._fillColor;
      this._strokeColor = state._strokeColor;
      this._lineWidth = state._lineWidth;
      this._globalAlpha = state._globalAlpha;
      this._font = state._font;
      this._textAlign = state._textAlign;
      this._textBaseline = state._textBaseline;
      this._lineCap = state._lineCap;
      this._lineJoin = state._lineJoin;
    }
  }

  // -------------------------------------------------------------------------
  // Private: WebGL helpers
  // -------------------------------------------------------------------------

  private _setColorUniform(loc: WebGLUniformLocation, color: Float32Array, alpha: number): void {
    // Premultiply globalAlpha into the color's alpha channel
    const a = color[3] * alpha;
    this._gl.uniform4f(loc, color[0], color[1], color[2], a);
  }

  private _createProgram(vSrc: string, fSrc: string, hasTexCoord: boolean): _ProgramInfo {
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

    // Delete shaders after linking (they're embedded in the program now)
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    return {
      _program: program,
      _matrixLoc: gl.getUniformLocation(program, 'u_matrix'),
      _colorLoc: gl.getUniformLocation(program, 'u_color'),
      _textureLoc: hasTexCoord ? gl.getUniformLocation(program, 'u_texture') : null,
      _positionLoc: gl.getAttribLocation(program, 'a_position'),
      _texCoordLoc: hasTexCoord ? gl.getAttribLocation(program, 'a_texCoord') : -1,
    };
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

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Extract numeric font size from a CSS font string like "bold 20px monospace". */
function _parseFontSize(font: string): number {
  const match = font.match(/(\d+(?:\.\d+)?)\s*px/);
  return match ? parseFloat(match[1]) : 10;
}
