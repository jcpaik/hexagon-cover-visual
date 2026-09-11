import type { Point } from '../types';

export type AbUnionCenterMode = 'none' | 'triangle' | 'circle' | 'local-c';
export type AbUnionQuality = 'coarse' | 'high' | 'adaptive';
export type AbUnionPreset = 'equality' | 'midpoint';
export type AbUnionTool = 'move' | 'add' | 'delete' | 'd-mark' | 's-mark' | 'f-mark';
export type AbUnionLockKind = 'a' | 'b';
export type AbUnionSumConstraintMode = 'none' | 'current' | 'one' | 'one-plus-delta';
export type AbUnionLabelMode = 'dynamic' | 'static';
export type AbUnionCoincidenceRole = 'shared' | 'left' | 'right';
export type AbUnionLocalRegionVariant = 'exact' | 'strict-two-line-superset';
export type AbUnionMarkSourceKind =
  | 'hex-edge'
  | 'half-diagonal'
  | 'center-triangle-edge'
  | 'center-circle';

export interface AbUnionEdgeDots {
  left: number;
  right: number;
  split: boolean;
}

// Source-family constraints, independent of any construction using the union.
export interface AbUnionRegionDefinition {
  index: number;
  a: number;
  b: number;
  restriction: 'ordinary' | 'in' | 'out' | 'both';
  criticality: 'any' | 'non-supercritical' | 'supercritical';
  requiredInteriorPoints: readonly Point[];
}

export interface AbUnionMarkSourceRef {
  kind: AbUnionMarkSourceKind;
  index: number;
}

export interface AbUnionLabel {
  id: string;
  name: string;
  mode: AbUnionLabelMode;
  first: AbUnionMarkSourceRef | null;
  second: AbUnionMarkSourceRef | null;
  point: Point | null;
}

export interface AbUnionCoincidenceLock {
  labelId: string;
  edge: number;
  role: AbUnionCoincidenceRole;
}

export interface AbUnionCoincidenceTarget {
  edge: number;
  role: AbUnionCoincidenceRole;
  label: string;
  locked: boolean;
}

export interface AbUnionFMark {
  id: string;
  point: Point;
}

export interface AbUnionState {
  edgeDots: AbUnionEdgeDots[];
  tool: AbUnionTool;
  theta: number;
  centerMode: AbUnionCenterMode;
  centerLocked: boolean;
  quality: AbUnionQuality;
  showOriginalRegion: boolean;
  showThetaTriangle: boolean;
  showFarPair: boolean;
  clipToCornerSectors: boolean;
  useAxisAlignedHull: boolean;
  autoOptimizeTheta: boolean;
  thetaOptimizationPending: boolean;
  regionVisible: boolean[];
  aLocked: boolean[];
  bLocked: boolean[];
  fixedSums: Array<number | null>;
  sumConstraintModes: AbUnionSumConstraintMode[];
  activeRegions: boolean[];
  labels: AbUnionLabel[];
  selectedMarkSources: AbUnionMarkSourceRef[];
  coincidenceLocks: AbUnionCoincidenceLock[];
  fMarks: AbUnionFMark[];
  selectedFMarkId: string | null;
  status: string;
  lastOptimized: AbUnionOptimization | null;
}

export interface AbUnionEdgeRow {
  index: number;
  left: number;
  right: number;
  split: boolean;
}

export interface AbUnionRegionRow {
  index: number;
  a: number;
  b: number;
  sum: number;
  distance: number;
  equality: boolean;
  aLocked: boolean;
  bLocked: boolean;
  fixedSum: number | null;
  sumConstraintMode: AbUnionSumConstraintMode;
  state: 'active' | 'limit' | 'empty';
}

export interface AbUnionOptimization {
  theta: number;
  L: number;
}

export interface AbUnionRenderResult {
  currentL: number;
  thetaTriangle: Point[] | null;
  uncoveredCount: number;
  analysisCount: number;
  centerContains: boolean;
  centerFailures: number;
  farPair: AbUnionFarPair | null;
  minEqualityGap: number;
  fMarkCount: number;
  fMarkDistance: number | null;
  fMarkTriangleSide: number | null;
  edgeRows: AbUnionEdgeRow[];
  regionRows: AbUnionRegionRow[];
  activeLabel: string;
}

export interface AbUnionFarPair {
  start: Point;
  end: Point;
  distance: number;
  exceedsUnit: boolean;
}

export interface AbUnionLocalLineSegment {
  start: Point;
  end: Point;
}

export interface AbUnionBoundaryRenderResult {
  fMarkCount: number;
  fMarkDistance: number | null;
  fMarkTriangleSide: number | null;
  edgeRows: AbUnionEdgeRow[];
  regionRows: AbUnionRegionRow[];
  activeLabel: string;
}

export interface AbUnionHexAxisHullSlab {
  uStart: number;
  uEnd: number;
  maxV: number;
  minDelta: number;
  maxDelta: number;
}

export interface AbUnionHexAxisHull {
  maxU: number;
  slabs: AbUnionHexAxisHullSlab[];
}

export type HexAxisHull = AbUnionHexAxisHull;

export type AbUnionDotRole = 'left' | 'right' | 'shared';

export interface AbUnionDotHandle {
  edge: number;
  role: AbUnionDotRole;
}

export type AbUnionMarkPrimitive =
  | { kind: 'line'; ref: AbUnionMarkSourceRef; label: string; start: Point; end: Point }
  | { kind: 'circle'; ref: AbUnionMarkSourceRef; label: string; center: Point; radius: number };
