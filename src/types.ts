export interface Point {
  x: number;
  y: number;
}

export interface TriangleState {
  position: Point;
  angle: number;
  controlPoint: Point;
}

export type ShapeMode = 'triangle' | 'local-c' | 'circle';

export type InteractionState =
  | { kind: 'idle' }
  | { kind: 'dragging-local-c-handle'; index: number }
  | { kind: 'dragging-triangle'; startMouse: Point; startPos: Point; startControl: Point }
  | { kind: 'rotating-triangle'; startMouse: Point; startAngle: number; startPos: Point }
  | { kind: 'dragging-control-point'; startMouse: Point; startControl: Point }
  | { kind: 'dragging-start-value' };
