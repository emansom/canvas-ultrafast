/**
 * GLSL ES 3.00 Shader Sources for canvas-ultrafast
 *
 * Content shaders (flat-color, textured) plus a passthrough display shader.
 * CRT post-processing shaders live in the maalata package.
 *
 * All shaders use #version 300 es (GLSL ES 3.00 / WebGL 2.0).
 *
 * Coordinate convention:
 * - Content shaders use a 3x3 affine matrix (u_matrix) that maps
 *   canvas pixel coordinates (top-left origin, Y-down) to clip space.
 * - Passthrough shader uses a fullscreen quad in [0,1] mapped to [-1,1] clip space.
 */

// ---------------------------------------------------------------------------
// Flat-color shader: rectangles, line quads, clear regions
// ---------------------------------------------------------------------------

export const FLAT_VERTEX_SRC = `#version 300 es
in vec2 a_position;
uniform mat3 u_matrix;
void main() {
  vec3 pos = u_matrix * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
}
`;

export const FLAT_FRAGMENT_SRC = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  fragColor = u_color;
}
`;

// ---------------------------------------------------------------------------
// Textured quad shader: text rendering via OffscreenCanvas glyph upload
// ---------------------------------------------------------------------------

export const TEXTURED_VERTEX_SRC = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
uniform mat3 u_matrix;
out vec2 v_texCoord;
void main() {
  vec3 pos = u_matrix * vec3(a_position, 1.0);
  gl_Position = vec4(pos.xy, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

export const TEXTURED_FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_texture;
uniform vec4 u_color;
out vec4 fragColor;
void main() {
  vec4 texel = texture(u_texture, v_texCoord);
  fragColor = texel * u_color;
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
export const PASSTHROUGH_VERTEX_SRC = `#version 300 es
in vec2 a_position;
out vec2 v_texCoord;
void main() {
  v_texCoord = a_position;
  gl_Position = vec4(a_position * 2.0 - 1.0, 0, 1);
}
`;

/**
 * Passthrough fragment shader: blit FBO texture to screen without effects.
 */
export const PASSTHROUGH_FRAGMENT_SRC = `#version 300 es
precision highp float;
in vec2 v_texCoord;
uniform sampler2D u_texture;
out vec4 fragColor;
void main() {
  fragColor = texture(u_texture, v_texCoord);
}
`;
