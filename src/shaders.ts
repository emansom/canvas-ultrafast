/**
 * GLSL Shader Sources for canvas-ultrafast
 *
 * Content shaders (flat-color, textured) plus a passthrough display shader.
 * CRT post-processing shaders live in the maalata package.
 *
 * Coordinate convention:
 * - Content shaders use a 3x3 affine matrix (u_matrix) that maps
 *   canvas pixel coordinates (top-left origin, Y-down) to clip space.
 * - Passthrough shader uses a fullscreen quad in [0,1] mapped to [-1,1] clip space.
 */

// ---------------------------------------------------------------------------
// Flat-color shader: rectangles, line quads, clear regions
// ---------------------------------------------------------------------------

export const FLAT_VERTEX_SRC = `
  attribute vec2 a_position;
  uniform mat3 u_matrix;
  void main() {
    vec3 pos = u_matrix * vec3(a_position, 1.0);
    gl_Position = vec4(pos.xy, 0.0, 1.0);
  }
`;

export const FLAT_FRAGMENT_SRC = `
  precision mediump float;
  uniform vec4 u_color;
  void main() {
    gl_FragColor = u_color;
  }
`;

// ---------------------------------------------------------------------------
// Textured quad shader: text rendering via OffscreenCanvas glyph upload
// ---------------------------------------------------------------------------

export const TEXTURED_VERTEX_SRC = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;
  uniform mat3 u_matrix;
  varying vec2 v_texCoord;
  void main() {
    vec3 pos = u_matrix * vec3(a_position, 1.0);
    gl_Position = vec4(pos.xy, 0.0, 1.0);
    v_texCoord = a_texCoord;
  }
`;

export const TEXTURED_FRAGMENT_SRC = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_texture;
  uniform vec4 u_color;
  void main() {
    vec4 texel = texture2D(u_texture, v_texCoord);
    gl_FragColor = texel * u_color;
  }
`;

// ---------------------------------------------------------------------------
// Passthrough display shader: fullscreen quad, reads FBO texture
// ---------------------------------------------------------------------------

/**
 * Vertex shader: fullscreen quad [0,1] → clip space [-1,1].
 * FBO textures are already in GL-native bottom-left origin (the orthographic
 * projection in matrix-stack.ts handles the canvas Y-down → GL Y-up flip),
 * so tex coords pass through without Y-flip.
 */
export const PASSTHROUGH_VERTEX_SRC = `
  attribute vec2 a_position;
  varying vec2 v_texCoord;
  void main() {
    v_texCoord = a_position;
    gl_Position = vec4(a_position * 2.0 - 1.0, 0, 1);
  }
`;

/**
 * Passthrough fragment shader: blit FBO texture to screen without effects.
 */
export const PASSTHROUGH_FRAGMENT_SRC = `
  precision mediump float;
  varying vec2 v_texCoord;
  uniform sampler2D u_texture;
  void main() {
    gl_FragColor = texture2D(u_texture, v_texCoord);
  }
`;
