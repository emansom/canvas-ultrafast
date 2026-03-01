/**
 * canvas-ultrafast — WebGL-accelerated Canvas 2D rendering engine
 *
 * Zero runtime dependencies. Provides a CanvasAPI for recording Canvas 2D
 * draw commands and a triple-buffered WebGL2 renderer that displays them
 * at vsync rate via passthrough shader.
 */

export { UltrafastRenderer } from './renderer';
export { CanvasAPI, type CanvasCommand } from './canvas-api';
export { parseColor } from './color-parser';
export { MatrixStack } from './matrix-stack';
