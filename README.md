# canvas-ultrafast

WebGL2-accelerated Canvas 2D rendering engine with triple-buffered framebuffers, command recording, and zero runtime dependencies.

## Why

The browser's built-in Canvas 2D context is convenient but synchronous — every `fillRect()` or `fillText()` call immediately rasterizes, blocking the main thread and coupling draw timing to display refresh. canvas-ultrafast decouples _what_ you draw from _when_ it reaches the screen:

1. **Record** — A `CanvasAPI` object captures draw calls as inert command objects instead of executing them.
2. **Execute** — A `Canvas2DShim` translates those commands into batched WebGL2 draw calls, writing into an off-screen framebuffer.
3. **Display** — A triple-buffered FBO pipeline rotates write → ready → display, so the screen always shows the most recent fully-rendered frame with no tearing and no synchronization overhead.

This architecture lets downstream consumers (like [maalata](https://github.com/emansom/maalata)) insert arbitrary latency stages, throttle rendering to retro frame rates, or apply post-processing shaders — all without modifying canvas-ultrafast itself.

## How it works

### Triple-buffered FBOs

Three framebuffer objects rotate through three roles:

```
 ┌───────────┐     submitBatch()     ┌───────────┐      RAF loop       ┌───────────┐
 │   Write   │ ──── swap ──────────► │   Ready   │ ──── blit ────────► │  Display  │
 │  (drawing) │                      │  (latest)  │                     │  (screen)  │
 └───────────┘                       └───────────┘                      └───────────┘
```

- **Write** — currently receiving draw commands via WebGL.
- **Ready** — holds the most recent complete frame; swapped in atomically by `submitBatch()`.
- **Display** — blitted to the canvas each animation frame.

Because JavaScript is single-threaded, the swap is lock-free — no mutexes, no fences, just index rotation.

### Command recording

`CanvasAPI` implements the familiar Canvas 2D interface (`fillRect`, `fillText`, `translate`, `save`/`restore`, …) but stores every call as a `CanvasCommand` instead of executing it:

```ts
type CanvasCommand =
  | { type: 'property'; name: string; value: unknown }
  | { type: 'method';   name: string; args: unknown[] };
```

Commands accumulate until drained via `takeCommands()`, which returns the buffer and resets it — a classic double-buffer drain pattern.

### WebGL execution

`Canvas2DShim` walks a command batch and maps each operation to WebGL2 primitives:

| Canvas 2D operation | WebGL2 implementation |
|---|---|
| `clearRect` | `gl.scissor()` + `gl.clear()` |
| `fillRect` | Unit quad VBO + flat-color shader + matrix transform |
| `strokeRect` | Four thin quads (one per edge) |
| `beginPath`/`lineTo`/`stroke` | Line segments expanded to quads on CPU, rendered as triangles |
| `fillText`/`strokeText` | Rasterize to OffscreenCanvas 2D, upload as texture, draw textured quad |
| `save`/`restore` | Matrix stack + state stack push/pop |
| Transforms | 3×3 affine matrix stack (column-major for `uniformMatrix3fv`) |

### Text rendering

Text is rasterized on a dedicated `OffscreenCanvas` (512×128) using the browser's native 2D text shaping, then uploaded to a WebGL texture via `texImage2D()`. This reuses the browser's full font stack — kerning, ligatures, `font` shorthand — without reimplementing any of it.

## API overview

```ts
import { UltrafastRenderer, CanvasAPI } from 'canvas-ultrafast';

// Create renderer — attaches a <canvas> with a WebGL2 context
const renderer = new UltrafastRenderer(width, height, container);

// Get the recording API (Canvas 2D-compatible)
const api: CanvasAPI = renderer.getCanvasAPI();

// Draw as usual
api.fillStyle = '#ff0000';
api.fillRect(10, 10, 100, 50);
api.font = '24px monospace';
api.fillText('hello', 20, 80);

// In the default auto-flush mode, the RAF loop drains commands
// and displays each frame automatically. Nothing else needed.
```

### Key exports

| Export | Role |
|---|---|
| `UltrafastRenderer` | WebGL2 context, FBO management, display loop |
| `CanvasAPI` | Command recording interface (Canvas 2D-compatible) |
| `CanvasCommand` | Type definition for recorded commands |
| `MatrixStack` | 3×3 affine transform stack |
| `parseColor()` | CSS color string → `Float32Array [r,g,b,a]` |

### Renderer methods

| Method | Description |
|---|---|
| `getCanvasAPI()` | Return the `CanvasAPI` instance |
| `submitBatch(commands)` | Execute commands into the write FBO, swap write ↔ ready |
| `startDisplay()` / `stopDisplay()` | Control the RAF display loop |
| `getReadyTexture()` | Return the ready FBO's texture for external rendering |
| `getGL()` | Access the underlying `WebGL2RenderingContext` |
| `getCanvas()` / `getCanvasSize()` | Canvas element and dimensions |
| `screenshot()` | Capture the current display frame as `ImageBitmap` |
| `destroy()` | Release all WebGL resources |

## Extension points

canvas-ultrafast is designed to be taken over by a downstream consumer. The pattern:

```ts
const renderer = new UltrafastRenderer(w, h, el);
renderer.stopDisplay();  // halt the built-in RAF loop

// Now you control timing:
const commands = renderer.getCanvasAPI().takeCommands();
renderer.submitBatch(commands);  // write FBO ← commands, swap write ↔ ready

// Read the result for custom post-processing:
const texture = renderer.getReadyTexture();
const gl = renderer.getGL();
// → bind texture, apply your own shader, draw to screen
```

[maalata](https://github.com/emansom/maalata) uses this to insert a 4-stage latency pipeline (USB → OS → App → LCD) and apply CRT post-processing (barrel distortion, scanlines, chromatic aberration, phosphor glow, black frame insertion) — all without any changes to canvas-ultrafast.

## Inspiration & prior art

canvas-ultrafast builds on well-established techniques from graphics programming and the web platform. Credit where it's due:

**Triple buffering** — A standard technique in graphics and game engines for decoupling rendering from display, eliminating tearing without the latency penalty of double buffering. Widely used in GPU drivers and compositors.

**Command recording / deferred rendering** — Inspired by the command buffer model in modern graphics APIs (Vulkan, Metal, Direct3D 12), where draw calls are recorded first and submitted for execution later. This separation enables batching, reordering, and custom timing.

**WebGL-accelerated Canvas 2D** — Libraries like [PixiJS](https://pixijs.com/), [Two.js](https://two.js.org/), and Google's [Skia/CanvasKit](https://skia.org/docs/user/modules/canvaskit/) have long demonstrated the performance benefits of executing 2D drawing operations through WebGL rather than the browser's built-in Canvas 2D implementation.

**`desynchronized` canvas hint** — The [`desynchronized`](https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-desynchronized) context attribute from the HTML spec (originating from the [Low Latency Canvas](https://discourse.wicg.io/t/proposal-delegated-ink-trail/4255/) proposal) bypasses the compositor for lower-latency rendering. canvas-ultrafast enables this by default.

**OffscreenCanvas for text rasterization** — Using [`OffscreenCanvas`](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas) with a 2D context as a glyph rendering surface, then uploading to a WebGL texture. This avoids reimplementing font shaping while keeping the rendering pipeline in WebGL.

**VBO orphaning** — A well-known pattern for streaming dynamic geometry to the GPU without stalling the pipeline. By calling `bufferData()` with a new size before `bufferSubData()`, the driver can allocate a fresh buffer and let the GPU finish reading from the old one. Described in the [OpenGL wiki](https://www.khronos.org/opengl/wiki/Buffer_Object_Streaming#Buffer_re-specification).

## License

[AGPL-3.0-only](LICENSE)
