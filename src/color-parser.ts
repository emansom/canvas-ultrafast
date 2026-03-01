/**
 * CSS Color Parser
 *
 * Converts CSS color strings to Float32Array [r, g, b, a] in [0, 1] range
 * for use as WebGL uniform values.
 *
 * Supported formats:
 * - Hex: #rgb, #rrggbb, #rrggbbaa
 * - Functional: rgb(r, g, b), rgba(r, g, b, a)
 * - Named: basic CSS color keywords
 *
 * Includes a cache for repeated lookups (the demo reuses ~10 colors).
 */

const _NAMED_COLORS: Record<string, number> = {
  black:       0x000000ff,
  white:       0xffffffff,
  red:         0xff0000ff,
  green:       0x008000ff,
  blue:        0x0000ffff,
  yellow:      0xffff00ff,
  cyan:        0x00ffffff,
  magenta:     0xff00ffff,
  orange:      0xffa500ff,
  transparent: 0x00000000,
};

const _cache = new Map<string, Float32Array>();

/**
 * Parse a CSS color string into [r, g, b, a] floats in [0, 1].
 * Returns a cached Float32Array — do NOT mutate the result.
 *
 * No _ prefix: called cross-file from canvas2d-shim.
 */
export function parseColor(css: string): Float32Array {
  const cached = _cache.get(css);
  if (cached) return cached;

  const result = _parse(css);
  _cache.set(css, result);
  return result;
}

function _parse(css: string): Float32Array {
  const s = css.trim();

  // #hex
  if (s.charCodeAt(0) === 0x23) { // '#'
    return _parseHex(s);
  }

  // rgb() / rgba()
  if (s.charCodeAt(0) === 0x72) { // 'r'
    return _parseRgb(s);
  }

  // Named color
  const named = _NAMED_COLORS[s.toLowerCase()];
  if (named !== undefined) {
    return new Float32Array([
      ((named >>> 24) & 0xff) / 255,
      ((named >>> 16) & 0xff) / 255,
      ((named >>> 8)  & 0xff) / 255,
      (named          & 0xff) / 255,
    ]);
  }

  // Fallback: opaque black
  return new Float32Array([0, 0, 0, 1]);
}

function _parseHex(s: string): Float32Array {
  const len = s.length;

  if (len === 4) {
    // #rgb → expand to #rrggbb
    const r = parseInt(s[1], 16);
    const g = parseInt(s[2], 16);
    const b = parseInt(s[3], 16);
    return new Float32Array([
      (r * 17) / 255,
      (g * 17) / 255,
      (b * 17) / 255,
      1,
    ]);
  }

  if (len === 7) {
    // #rrggbb
    const r = parseInt(s.slice(1, 3), 16);
    const g = parseInt(s.slice(3, 5), 16);
    const b = parseInt(s.slice(5, 7), 16);
    return new Float32Array([r / 255, g / 255, b / 255, 1]);
  }

  if (len === 9) {
    // #rrggbbaa
    const r = parseInt(s.slice(1, 3), 16);
    const g = parseInt(s.slice(3, 5), 16);
    const b = parseInt(s.slice(5, 7), 16);
    const a = parseInt(s.slice(7, 9), 16);
    return new Float32Array([r / 255, g / 255, b / 255, a / 255]);
  }

  // #rgba (4-digit with alpha)
  if (len === 5) {
    const r = parseInt(s[1], 16);
    const g = parseInt(s[2], 16);
    const b = parseInt(s[3], 16);
    const a = parseInt(s[4], 16);
    return new Float32Array([
      (r * 17) / 255,
      (g * 17) / 255,
      (b * 17) / 255,
      (a * 17) / 255,
    ]);
  }

  return new Float32Array([0, 0, 0, 1]);
}

function _parseRgb(s: string): Float32Array {
  // Match both rgb(...) and rgba(...)
  // Extract the numeric values between parentheses
  const start = s.indexOf('(');
  const end = s.lastIndexOf(')');
  if (start === -1 || end === -1) return new Float32Array([0, 0, 0, 1]);

  const parts = s.slice(start + 1, end).split(',');
  const r = parseFloat(parts[0]) / 255;
  const g = parseFloat(parts[1]) / 255;
  const b = parseFloat(parts[2]) / 255;
  const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;

  return new Float32Array([r, g, b, a]);
}
