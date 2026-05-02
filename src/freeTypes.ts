import type { Point } from './types';

export type FreeTriangleId = 'C' | 'V0' | 'V1' | 'V2' | 'V3' | 'V4' | 'V5';
export type FreeTarget = 'S_HALF' | 'S';
export type FreeTool = 'move' | 'mark';
export type NamedPointKind = 'O' | 'M' | 'V' | 'label' | 'manual';
export type FreeSegmentKind = 'hex-edge' | 'half-diagonal' | 'triangle-edge';

export interface FreeNamedPointRef {
  kind: NamedPointKind;
  index?: number;
  labelId?: string;
  manualPoint?: Point;
}

export interface FreeSegmentRef {
  kind: FreeSegmentKind;
  index: number;
  triangleId?: FreeTriangleId;
}

export interface FreeLabel {
  id: string;
  name: string;
  first: FreeSegmentRef;
  second: FreeSegmentRef;
  point: Point | null;
}

export interface FreeEdgePointConstraint {
  edgeIndex: number;
  point: FreeNamedPointRef;
}

export interface FreeTriangleState {
  id: FreeTriangleId;
  center: Point;
  angle: number;
  fixed: boolean;
  hidden: boolean;
  midpointConstraints: boolean[];
  edgePointConstraint: FreeEdgePointConstraint | null;
}

export interface FreeState {
  target: FreeTarget;
  tool: FreeTool;
  strictEps: number;
  selectedTriangleId: FreeTriangleId;
  triangles: FreeTriangleState[];
  labels: FreeLabel[];
  selectedSegments: FreeSegmentRef[];
  status: string;
}

export interface FreeSegment {
  ref: FreeSegmentRef;
  start: Point;
  end: Point;
  label: string;
}

export interface FreeValidationSegment {
  kind: 'edge' | 'diag';
  index: number;
  gaps: Array<[number, number]>;
  intervals: Array<[number, number]>;
}

export interface FreeConstraintStatus {
  triangleId: FreeTriangleId;
  ok: boolean;
  messages: string[];
}

export interface FreeValidationResult {
  coverageOk: boolean;
  constraintsOk: boolean;
  segments: FreeValidationSegment[];
  pointFailures: string[];
  constraintStatuses: FreeConstraintStatus[];
}
