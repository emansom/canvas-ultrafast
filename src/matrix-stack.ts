/**
 * 3×3 Affine Transform Matrix Stack
 *
 * Replicates Canvas 2D's save()/restore()/translate()/rotate()/scale()
 * as a matrix stack for WebGL uniform upload.
 *
 * Matrices are 3×3 column-major (for gl.uniformMatrix3fv), representing
 * 2D affine transforms. The base matrix includes an orthographic projection
 * that maps canvas pixel coordinates (top-left origin, Y-down) to WebGL
 * clip space ([-1,1], Y-up).
 *
 * Column-major layout of a 3×3 affine matrix:
 *   [0]  [3]  [6]     a  c  tx
 *   [1]  [4]  [7]  =  b  d  ty
 *   [2]  [5]  [8]     0  0  1
 */

export class MatrixStack {
  private _stack: Float32Array[] = [];
  private _current: Float32Array;
  private _projection: Float32Array;

  /**
   * @param width  Canvas width in pixels
   * @param height Canvas height in pixels
   */
  constructor(width: number, height: number) {
    this._projection = _ortho(width, height);
    this._current = new Float32Array(this._projection);
  }

  /** Push current matrix onto the stack. No _ prefix: cross-file. */
  save(): void {
    this._stack.push(new Float32Array(this._current));
  }

  /** Pop and restore the top matrix. No _ prefix: cross-file. */
  restore(): void {
    if (this._stack.length > 0) {
      this._current = this._stack.pop()!;
    }
  }

  /** Translate the current matrix. No _ prefix: cross-file. */
  translate(x: number, y: number): void {
    // Multiply current matrix by translation:
    //   1  0  tx
    //   0  1  ty
    //   0  0  1
    // In column-major: m[6] += m[0]*tx + m[3]*ty
    //                  m[7] += m[1]*tx + m[4]*ty
    const m = this._current;
    m[6] += m[0] * x + m[3] * y;
    m[7] += m[1] * x + m[4] * y;
  }

  /** Rotate the current matrix by angle (radians). No _ prefix: cross-file. */
  rotate(angle: number): void {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const m = this._current;
    const m0 = m[0], m1 = m[1], m3 = m[3], m4 = m[4];
    m[0] = m0 * c + m3 * s;
    m[1] = m1 * c + m4 * s;
    m[3] = m0 * -s + m3 * c;
    m[4] = m1 * -s + m4 * c;
  }

  /** Scale the current matrix. No _ prefix: cross-file. */
  scale(x: number, y: number): void {
    const m = this._current;
    m[0] *= x; m[1] *= x;
    m[3] *= y; m[4] *= y;
  }

  /**
   * Multiply current matrix by an arbitrary 2D affine transform.
   * Canvas 2D transform(a, b, c, d, e, f) matrix:
   *   a  c  e
   *   b  d  f
   *   0  0  1
   * No _ prefix: cross-file.
   */
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const m = this._current;
    const m0 = m[0], m1 = m[1], m3 = m[3], m4 = m[4], m6 = m[6], m7 = m[7];
    m[0] = m0 * a + m3 * b;
    m[1] = m1 * a + m4 * b;
    m[3] = m0 * c + m3 * d;
    m[4] = m1 * c + m4 * d;
    m[6] = m0 * e + m3 * f + m6;
    m[7] = m1 * e + m4 * f + m7;
  }

  /**
   * Reset to projection then apply the given affine transform.
   * Canvas 2D setTransform(a, b, c, d, e, f).
   * No _ prefix: cross-file.
   */
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this._current.set(this._projection);
    this.transform(a, b, c, d, e, f);
  }

  /** Reset to the base orthographic projection. No _ prefix: cross-file. */
  resetTransform(): void {
    this._current.set(this._projection);
  }

  /**
   * Update canvas dimensions (e.g., on resize).
   * Recomputes the projection and resets the current matrix.
   * No _ prefix: cross-file.
   */
  resize(width: number, height: number): void {
    this._projection = _ortho(width, height);
    this._current = new Float32Array(this._projection);
    this._stack = [];
  }

  /**
   * Returns the current 3×3 matrix for gl.uniformMatrix3fv.
   * No _ prefix: cross-file.
   */
  getMatrix(): Float32Array {
    return this._current;
  }
}

/**
 * Create an orthographic projection matrix that maps:
 *   Canvas coords (0,0)=top-left, (w,h)=bottom-right, Y-down
 *   → Clip space (-1,-1)=bottom-left, (1,1)=top-right, Y-up
 *
 * The transform is:
 *   x_clip = x * 2/w - 1
 *   y_clip = -(y * 2/h - 1) = 1 - y * 2/h
 *
 * Column-major 3×3:
 *   2/w    0    -1
 *    0   -2/h    1
 *    0     0     1
 */
function _ortho(w: number, h: number): Float32Array {
  return new Float32Array([
    2 / w,  0,     0,   // column 0
    0,     -2 / h, 0,   // column 1
    -1,     1,     1,   // column 2
  ]);
}
