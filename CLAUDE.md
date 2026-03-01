# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build
npm run build         # Build library (production)
npm run build:dev     # Build library (development, sourcemaps, no mangling)
npm run build:all     # Build library (prod) + demo (prod)
npm run build:dev-all # Build library (dev) + demo (dev)
npm run type-check    # TypeScript type check + lint
npm run clean         # Remove all dist/ directories
npm run verify-demo   # Build dev → serve → Playwright headless test demo

# Demo
npm run build -w demo # Build demo only
npm run serve:demo    # Build all + serve demo on :4174
npm run serve         # Serve pre-built demo/dist/ on :4174
```

## Testing

**Always run `npm run verify-demo` after modifying any source file** (`src/`, `demo/src/`).
This script:
1. Builds the library and demo in **development mode** (sourcemaps, no minification/mangling)
2. Starts a static server for the demo on :4174
3. Launches headless Chromium via Playwright
4. Navigates, clicks all buttons, samples 10 animation frames, profiles CPU
5. Collects JS exceptions, console.error/warning, failed network requests, visual issues
6. Exits 0 if clean, 1 if any errors were found

Fix all reported errors, then re-run until the exit code is 0 before considering any change complete.

## Architecture

Standalone WebGL-accelerated Canvas 2D rendering engine. Zero runtime dependencies.

### Source (`src/`)

- **`renderer.ts`**: `UltrafastRenderer` class. Creates a WebGL2 context on the user's canvas, manages triple-buffered FBOs, runs a passthrough RAF display loop with auto-flush.
- **`canvas-api.ts`**: `CanvasAPI` records Canvas 2D context calls as `CanvasCommand` objects without executing them.
- **`canvas2d-shim.ts`**: Translates `CanvasCommand[]` into WebGL draw calls (fillRect, strokeRect, text, line quads, transforms).
- **`shaders.ts`**: GLSL sources for flat-color, textured, and passthrough display shaders.
- **`color-parser.ts`**: CSS color string → `Float32Array [r,g,b,a]` with caching.
- **`matrix-stack.ts`**: 3×3 affine transform stack mapping canvas coordinates to clip space.

### Key design decisions

- **Triple-buffered FBOs**: Write → Ready → Display rotation. `submitBatch()` swaps write↔ready. RAF reads from ready. Lock-free via JS single-threading.
- **Auto-flush**: The RAF display loop drains `CanvasAPI.takeCommands()` each frame, so canvas calls are naturally batched and displayed at vsync rate.
- **esbuild `mangleProps: /^_/`**: All `_`-prefixed properties are renamed in production. Cross-file methods must NOT use `_` prefix.

### Cross-file methods (no `_` prefix)

- `UltrafastRenderer.submitBatch/startDisplay/stopDisplay/getGL/getReadyTexture/getCanvas/getCanvasAPI/getCanvasSize/screenshot/destroy`
- `CanvasAPI.takeCommands()`
- `Canvas2DShim.executeBatch/resize/destroy`
- `MatrixStack.save/restore/translate/rotate/scale/getMatrix/resize`
- `parseColor()`

### Build output

ES + UMD formats with `.d.ts` declarations via `vite-plugin-dts`. Filenames include a per-build content hash.

### Demo (`demo/`)

Tests canvas-ultrafast standalone — raw WebGL renderer at 60 FPS via RAF, no pipeline, no CRT.
Visual elements: green pulsing rect, magenta rotating square, orange sine wave, blue buttons.
