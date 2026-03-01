/**
 * Canvas API Wrapper
 *
 * Provides a Canvas 2D API that records commands locally without await.
 * Commands are batched and sent to the worker for execution.
 */

type CanvasPropertyMap = {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  miterLimit: number;
  lineDashOffset: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  globalAlpha: number;
  globalCompositeOperation: GlobalCompositeOperation;
  shadowBlur: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
};

export type CanvasCommand =
  | { type: 'property'; name: string; value: unknown }
  | { type: 'method'; name: string; args: unknown[] };

export class CanvasAPI {
  private _c: CanvasCommand[] = [];
  private _cp: Partial<CanvasPropertyMap> = {};

  private _m(n: string, ...a: unknown[]): void {
    this._c.push({ type: 'method', name: n, args: a });
  }

  private _p<K extends keyof CanvasPropertyMap>(n: K, v: CanvasPropertyMap[K]): void {
    this._cp[n] = v;
    this._c.push({ type: 'property', name: n, value: v });
  }

  /**
   * Drain and return all buffered commands.
   * No _ prefix: called cross-file from pipeline, must survive mangleProps.
   */
  takeCommands(): CanvasCommand[] {
    if (this._c.length === 0) return [];
    const cmds = this._c;
    this._c = [];
    return cmds;
  }

  // Canvas 2D API methods

  // State
  save(): void { this._m('save'); }
  restore(): void { this._m('restore'); }

  // Transform
  scale(x: number, y: number): void { this._m('scale', x, y); }
  rotate(angle: number): void { this._m('rotate', angle); }
  translate(x: number, y: number): void { this._m('translate', x, y); }
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void { this._m('transform', a, b, c, d, e, f); }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void { this._m('setTransform', a, b, c, d, e, f); }
  resetTransform(): void { this._m('resetTransform'); }

  // Rectangles
  clearRect(x: number, y: number, width: number, height: number): void { this._m('clearRect', x, y, width, height); }
  fillRect(x: number, y: number, width: number, height: number): void { this._m('fillRect', x, y, width, height); }
  strokeRect(x: number, y: number, width: number, height: number): void { this._m('strokeRect', x, y, width, height); }

  // Text
  fillText(text: string, x: number, y: number, maxWidth?: number): void {
    this._m('fillText', ...(maxWidth !== undefined ? [text, x, y, maxWidth] : [text, x, y]));
  }

  strokeText(text: string, x: number, y: number, maxWidth?: number): void {
    this._m('strokeText', ...(maxWidth !== undefined ? [text, x, y, maxWidth] : [text, x, y]));
  }

  // Line drawing
  beginPath(): void { this._m('beginPath'); }
  closePath(): void { this._m('closePath'); }
  moveTo(x: number, y: number): void { this._m('moveTo', x, y); }
  lineTo(x: number, y: number): void { this._m('lineTo', x, y); }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this._m('bezierCurveTo', cp1x, cp1y, cp2x, cp2y, x, y);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void { this._m('quadraticCurveTo', cpx, cpy, x, y); }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void {
    this._m('arc', ...(counterclockwise !== undefined ? [x, y, radius, startAngle, endAngle, counterclockwise] : [x, y, radius, startAngle, endAngle]));
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void { this._m('arcTo', x1, y1, x2, y2, radius); }

  ellipse(x: number, y: number, radiusX: number, radiusY: number, rotation: number, startAngle: number, endAngle: number, counterclockwise?: boolean): void {
    this._m('ellipse', ...(counterclockwise !== undefined ? [x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise] : [x, y, radiusX, radiusY, rotation, startAngle, endAngle]));
  }

  rect(x: number, y: number, width: number, height: number): void { this._m('rect', x, y, width, height); }

  // Fill and stroke
  fill(): void { this._m('fill'); }
  stroke(): void { this._m('stroke'); }
  clip(): void { this._m('clip'); }

  // Properties (setters)
  set fillStyle(value: string | CanvasGradient | CanvasPattern) { this._p('fillStyle', value); }
  set strokeStyle(value: string | CanvasGradient | CanvasPattern) { this._p('strokeStyle', value); }
  set lineWidth(value: number) { this._p('lineWidth', value); }
  set lineCap(value: CanvasLineCap) { this._p('lineCap', value); }
  set lineJoin(value: CanvasLineJoin) { this._p('lineJoin', value); }
  set miterLimit(value: number) { this._p('miterLimit', value); }
  set lineDashOffset(value: number) { this._p('lineDashOffset', value); }
  set font(value: string) { this._p('font', value); }
  set textAlign(value: CanvasTextAlign) { this._p('textAlign', value); }
  set textBaseline(value: CanvasTextBaseline) { this._p('textBaseline', value); }
  set globalAlpha(value: number) { this._p('globalAlpha', value); }
  set globalCompositeOperation(value: GlobalCompositeOperation) { this._p('globalCompositeOperation', value); }
  set shadowBlur(value: number) { this._p('shadowBlur', value); }
  set shadowColor(value: string) { this._p('shadowColor', value); }
  set shadowOffsetX(value: number) { this._p('shadowOffsetX', value); }
  set shadowOffsetY(value: number) { this._p('shadowOffsetY', value); }

  // Property getters (return local cached values)
  get fillStyle() { return this._cp['fillStyle'] ?? '#000'; }
  get strokeStyle() { return this._cp['strokeStyle'] ?? '#000'; }
  get lineWidth() { return this._cp['lineWidth'] ?? 1; }
  get lineCap() { return this._cp['lineCap'] ?? 'butt'; }
  get lineJoin() { return this._cp['lineJoin'] ?? 'miter'; }
  get miterLimit() { return this._cp['miterLimit'] ?? 10; }
  get lineDashOffset() { return this._cp['lineDashOffset'] ?? 0; }
  get font() { return this._cp['font'] ?? '10px sans-serif'; }
  get textAlign() { return this._cp['textAlign'] ?? 'start'; }
  get textBaseline() { return this._cp['textBaseline'] ?? 'alphabetic'; }
  get globalAlpha() { return this._cp['globalAlpha'] ?? 1; }
  get globalCompositeOperation() { return this._cp['globalCompositeOperation'] ?? 'source-over'; }
  get shadowBlur() { return this._cp['shadowBlur'] ?? 0; }
  get shadowColor() { return this._cp['shadowColor'] ?? 'rgba(0, 0, 0, 0)'; }
  get shadowOffsetX() { return this._cp['shadowOffsetX'] ?? 0; }
  get shadowOffsetY() { return this._cp['shadowOffsetY'] ?? 0; }
}