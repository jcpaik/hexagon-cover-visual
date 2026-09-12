import type { Point } from '../types';
import type { FreeTriangleState } from '../freeTypes';
import { freeTriangleToCoverTriangle, triangleVertices } from '../freeGeometry';
import { fitTriangle, intervalOnSegment, type CoverTriangle } from '../cover';
import { HEXAGON_VERTICES } from '../hexagon';
import { algorithm2CStar } from '../radialCapacity';

const EPS = 1e-9;
const H = Math.sqrt(3) / 2;
const ORIGIN: Point = { x: 0, y: 0 };
type PointIds = ReadonlySet<string> | readonly string[];

export interface BCParameters {
  left: number;
  right: number;
  radial: [number, number, number];
}

export interface DParameters {
  a: number;
  epsilon: number;
  beta: number;
}

export const DEFAULT_BC_PARAMETERS: BCParameters = { left: 0.5, right: 0.65, radial: [0.5, 0.5, 0.5] };
export const DEFAULT_D_PARAMETERS: DParameters = { a: 0.2, epsilon: 0.4, beta: 0.5 };
export const NINE_POINT_IDS = ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'Q-', 'Q0', 'Q+'] as const;

export type NinePointConstruction = 'frontier' | 'newton';

export interface WitnessPoint {
  id: string;
  // Selection IDs stay stable across constructions; symbols name the plotted points.
  symbol?: string;
  label: string;
  point: Point | null;
  enabled: boolean;
}

export interface WitnessCondition {
  id: string;
  label: string;
  ok: boolean;
  group?: 'geometry' | 'source';
}

export interface WitnessSegment {
  id: string;
  label: string;
  start: Point;
  end: Point;
}

export interface ActualReach {
  index: number;
  a: number;
  b: number;
  c: number;
  neighbors: [number, number];
  gamma: number;
  radial: number;
  vertexInside: boolean;
}

export interface WitnessEvaluation {
  points: WitnessPoint[];
  enabledPointCount: number;
  triangle: CoverTriangle | null;
  side: number | null;
  conditions: WitnessCondition[];
  status: string;
  domainOk: boolean;
  domainStatus: string;
  theoremApplicable: boolean;
  geometryApplicable: boolean;
  sourceApplicable: boolean | null;
  segments: WitnessSegment[];
  reaches: ActualReach[] | null;
  parameters: BCParameters | DParameters | null;
}

export interface NinePointEvaluation {
  pointConstruction: NinePointConstruction;
  a: number;
  b: number;
  domainOk: boolean;
  domainStatus: string;
  cStar: number | null;
  diskRadius: number | null;
  circles: Array<{ id: 'C2' | 'C5'; center: Point }>;
  points: WitnessPoint[];
  enabledPointCount: number;
  triangle: CoverTriangle | null;
  side: number | null;
  strictGap: number;
  localRegionVariant: 'exact';
  status: string;
}

function scale(value: number, point: Point): Point {
  return { x: value * point.x, y: value * point.y };
}

function interpolate(start: Point, end: Point, t: number): Point {
  return { x: start.x + t * (end.x - start.x), y: start.y + t * (end.y - start.y) };
}

function edgePoint(index: number, t: number): Point {
  return interpolate(HEXAGON_VERTICES[index], HEXAGON_VERTICES[(index + 1) % 6], t);
}

function asSet(ids: PointIds | undefined): ReadonlySet<string> {
  return ids instanceof Set ? ids : new Set(ids);
}

function witness(id: string, label: string, point: Point | null, disabled: ReadonlySet<string>): WitnessPoint {
  return { id, label, point: point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null, enabled: !disabled.has(id) };
}

function fitWitnesses(points: WitnessPoint[]): Pick<WitnessEvaluation, 'enabledPointCount' | 'triangle' | 'side'> {
  const enabled = points.filter((point) => point.enabled);
  const concrete = enabled.flatMap((point) => point.point ? [point.point] : []);
  const triangle = concrete.length > 0 && concrete.length === enabled.length
    ? fitTriangle('Strategy 3', concrete, '#eab308')
    : null;
  return { enabledPointCount: enabled.length, triangle, side: triangle?.side ?? null };
}

function result(
  points: WitnessPoint[],
  parameters: WitnessEvaluation['parameters'],
  conditions: WitnessCondition[],
  segments: WitnessSegment[],
  suppliedBC = false,
  requireSource = false,
): WitnessEvaluation {
  const domainOk = conditions.filter((condition) => condition.group !== 'source').every((condition) => condition.ok);
  const sourceConditions = conditions.filter((condition) => condition.group === 'source');
  const sourceApplicable = sourceConditions.length > 0 ? sourceConditions.every((condition) => condition.ok) : null;
  const fitted = fitWitnesses(points);
  const domainStatus = domainOk ? 'construction conditions met' : 'construction conditions not met';
  const completeSet = points.every((point) => point.enabled);
  const status = fitted.enabledPointCount === 0 ? 'no points selected'
    : suppliedBC ? `supplied radial data; BC source hypotheses are not verified${completeSet ? '' : '; subset fit uses only selected points'}`
      : !completeSet ? `${domainStatus}; subset fit uses only selected points`
        : sourceApplicable === false ? `${domainStatus}; source adapter conditions not met` : domainStatus;
  return {
    points, ...fitted, parameters, conditions, segments, reaches: null,
    domainOk, domainStatus, geometryApplicable: domainOk, sourceApplicable,
    theoremApplicable: domainOk && !suppliedBC && completeSet && (!requireSource || sourceApplicable === true), status,
  };
}

// 2612, Theorem 5.1: these five coordinates specify the displayed set;
// only deriveBC checks the original-triangle hypotheses behind the enclosure.
export function buildBC(parameters: BCParameters, disabledIds?: PointIds): WitnessEvaluation {
  const disabled = asSet(disabledIds);
  const { left, right, radial } = parameters;
  const points = [
    witness('M0', 'C midpoint M0', scale(0.5, HEXAGON_VERTICES[0]), disabled),
    witness('G0', 'selected gap start', edgePoint(0, left), disabled),
    witness('G1', 'selected gap end', edgePoint(0, right), disabled),
    ...radial.map((d, index) => witness(`D${index + 2}`, `total endpoint on r${index + 2}`, scale(d, HEXAGON_VERTICES[index + 2]), disabled)),
  ];
  const conditions = [
    { id: 'gap', label: '0 < left ≤ right < 1 (singleton allowed)', ok: left > 0 && left <= right && right < 1 },
    { id: 'radial', label: '0 < d2, d3, d4 < 1', ok: radial.every((d) => d > 0 && d < 1) },
  ];
  const segments = [{ id: 'gap', label: 'selected gap', start: edgePoint(0, left), end: edgePoint(0, right) }];
  return result(points, parameters, conditions, segments, true);
}

// 2612, Theorem 6.1. Endpoint and coincident-point cases are included.
export function buildD(parameters: DParameters, disabledIds?: PointIds): WitnessEvaluation {
  const disabled = asSet(disabledIds);
  const { a, epsilon, beta } = parameters;
  const s = a + epsilon;
  const y = (t: number) => interpolate(HEXAGON_VERTICES[0], HEXAGON_VERTICES[5], t);
  const points = [
    witness('O', 'origin', ORIGIN, disabled),
    witness('PT', 'supported radial endpoint', scale(epsilon, HEXAGON_VERTICES[1]), disabled),
    witness('G0', 'Y(a)', y(a), disabled),
    witness('G1', 'Y(1−β)', y(1 - beta), disabled),
  ];
  const conditions = [
    { id: 'signs', label: 'a ≥ 0, ε > 0, β ≥ 0', ok: a >= 0 && epsilon > 0 && beta >= 0 && [a, epsilon, beta].every(Number.isFinite) },
    { id: 'sum', label: 'a + ε ≤ 1', ok: s <= 1 },
    { id: 'order', label: 'a ≤ ε', ok: a <= epsilon },
    { id: 'ratio', label: 'β ≤ ε / (a + ε)', ok: s > 0 && beta <= epsilon / s },
  ];
  return result(points, parameters, conditions, [{ id: 'gap', label: 'boundary witnesses', start: y(a), end: y(1 - beta) }]);
}

// Clip a segment against the three closed halfplanes of a unit triangle.
// Coordinates are parameters on [start,end], not Euclidean distances.
export function segmentTriangleInterval(
  triangle: FreeTriangleState,
  start: Point,
  end: Point,
): [number, number] | null {
  return intervalOnSegment(start, end, freeTriangleToCoverTriangle(triangle));
}

function strictlyContains(triangle: FreeTriangleState, point: Point): boolean {
  const vertices = triangleVertices(triangle.center, triangle.angle);
  return vertices.every((a, index) => {
    const b = vertices[(index + 1) % 3];
    return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x) > EPS;
  });
}

export function extractActualReaches(triangles: readonly FreeTriangleState[]): ActualReach[] {
  const roles = HEXAGON_VERTICES.map((_, index) => triangles.find((triangle) => triangle.id === `V${index}`));
  const radialEnd = (role: number, ray: number): number => {
    const triangle = roles[(role + 6) % 6];
    const interval = triangle ? segmentTriangleInterval(triangle, HEXAGON_VERTICES[ray], ORIGIN) : null;
    return interval && interval[1] - interval[0] > EPS ? interval[1] : 0;
  };
  return HEXAGON_VERTICES.map((vertex, index) => {
    const triangle = roles[index];
    const preceding = triangle ? segmentTriangleInterval(triangle, vertex, HEXAGON_VERTICES[(index + 5) % 6]) : null;
    const following = triangle ? segmentTriangleInterval(triangle, vertex, HEXAGON_VERTICES[(index + 1) % 6]) : null;
    const a = preceding && preceding[0] <= EPS ? preceding[1] : 0;
    const b = following && following[0] <= EPS ? following[1] : 0;
    const ownRadial = triangle ? segmentTriangleInterval(triangle, vertex, ORIGIN) : null;
    const c = ownRadial && ownRadial[0] <= EPS ? ownRadial[1] : 0;
    const neighbors: [number, number] = [radialEnd(index - 1, index), radialEnd(index + 1, index)];
    const gamma = Math.max(c, ...neighbors);
    return { index, a, b, c, neighbors, gamma, radial: 1 - gamma, vertexInside: triangle ? strictlyContains(triangle, vertex) : false };
  });
}

function vertexCondition(reaches: ActualReach[]): WitnessCondition {
  return { id: 'vertices', group: 'source', label: 'Each V_i lies strictly inside its assigned unit triangle', ok: reaches.every((row) => row.vertexInside) };
}

function pathCondition(reaches: ActualReach[]): WitnessCondition {
  return { id: 'path', group: 'source', label: 'B_i + A_(i+1) > 1 on the four middle edges', ok: [1, 2, 3, 4].every((index) => reaches[index].b + reaches[index + 1].a > 1 + EPS) };
}

export function deriveBC(triangles: readonly FreeTriangleState[], disabledIds?: PointIds): WitnessEvaluation {
  const reaches = extractActualReaches(triangles);
  const parameters: BCParameters = {
    left: reaches[0].b,
    right: 1 - reaches[1].a,
    radial: [reaches[2].radial, reaches[3].radial, reaches[4].radial],
  };
  const built = buildBC(parameters, disabledIds);
  const conditions: WitnessCondition[] = [
    vertexCondition(reaches),
    ...built.conditions,
    { id: 'nonsupercritical', group: 'source', label: 'A_i + B_i ≤ 1 for i = 1,…,5', ok: reaches.slice(1).every((row) => row.a + row.b <= 1 + EPS) },
    pathCondition(reaches),
    { id: 'tail', group: 'source', label: 'B5 ≥ B0 / 2', ok: reaches[5].b >= reaches[0].b / 2 - EPS },
  ];
  return { ...result(built.points, parameters, conditions, built.segments, false, true), reaches };
}

export function deriveD(triangles: readonly FreeTriangleState[], disabledIds?: PointIds): WitnessEvaluation {
  const reaches = extractActualReaches(triangles);
  const supplier = triangles.find((triangle) => triangle.id === 'V0');
  const interval = supplier ? segmentTriangleInterval(supplier, HEXAGON_VERTICES[1], ORIGIN) : null;
  const c = interval?.[0] ?? NaN;
  const u = interval?.[1] ?? NaN;
  const parameters: DParameters = { a: reaches[0].a, epsilon: 1 - u, beta: reaches[5].b };
  const built = buildD(parameters, disabledIds);
  const m = c >= 0 && c <= 0.5 ? (c + Math.sqrt(c * c - 8 * c + 4)) / 2 : NaN;
  const conditions: WitnessCondition[] = [
    vertexCondition(reaches),
    { id: 'supplier', group: 'source', label: 'V0 triangle supplies M1: 0 < c < 1/2 < u < 1', ok: c > 0 && c < 0.5 && u > 0.5 && u < 1 && !!supplier && strictlyContains(supplier, scale(0.5, HEXAGON_VERTICES[1])) },
    ...built.conditions,
    { id: 'frontier', group: 'source', label: 'u is the total radial endpoint on r1', ok: Math.abs(u - reaches[1].gamma) <= EPS },
    { id: 'near-endpoint', group: 'source', label: 'C1 ≥ c', ok: reaches[1].c >= c - EPS },
    { id: 'supercritical', group: 'source', label: 'T1 is the unique supercritical vertex triangle', ok: reaches[1].a + reaches[1].b > 1 + EPS && reaches.every((row) => row.index === 1 || row.a + row.b <= 1 + EPS) },
    pathCondition(reaches),
    { id: 'adapter-ratio', group: 'source', label: 'A0 / (A0 + ε) ≤ 1 − M_c', ok: parameters.a / (parameters.a + parameters.epsilon) <= 1 - m + EPS },
  ];
  const segments = interval ? [...built.segments, {
    id: 'support', label: 'actual supported interval [c,u]',
    start: scale(1 - c, HEXAGON_VERTICES[1]), end: scale(1 - u, HEXAGON_VERTICES[1]),
  }] : built.segments;
  return { ...result(built.points, parameters, conditions, segments), reaches };
}

// 31053, equations (7)–(19), in the chart V4 + u(V5−V4) + v(V3−V4).
// The frontier mode retains the selected first roots. Newton mode uses exactly
// one tangent step from their common junction, as in the paper's Appendix E
// (Newton inner reduction); neither mode samples or uses a Core fallback.
export function evaluateNinePoint(
  a: number, b: number, enabledIds?: PointIds, pointConstruction: NinePointConstruction = 'frontier',
): NinePointEvaluation {
  const enabled = enabledIds === undefined ? new Set<string>(NINE_POINT_IDS) : asSet(enabledIds);
  const disabled = new Set(NINE_POINT_IDS.filter((id) => !enabled.has(id)));
  const rho = a * a + a * b + b * b;
  const domainOk = Number.isFinite(a) && Number.isFinite(b) && a > 0 && a < 1 && b > 0 && b < 1 && a + b > 1 && rho < 1;
  const domainStatus = domainOk ? 'inside strict domain' : 'requires 0 < a,b < 1, a+b > 1, a²+ab+b² < 1';
  let cStar: number | null = null;
  let diskRadius: number | null = null;
  const circles: NinePointEvaluation['circles'] = [];
  const coordinates = new Map<string, Point>();
  if (domainOk) {
    cStar = algorithm2CStar(1 - b, 1 - a);
    diskRadius = H * (1 - cStar);
    for (let index = 0; index < 6; index++) coordinates.set(`D${index}`, scale(1 - cStar, HEXAGON_VERTICES[index]));
    circles.push({ id: 'C2', center: edgePoint(2, b) }, { id: 'C5', center: edgePoint(5, 1 - a) });
    const d = Math.sqrt(4 * rho - 3);
    const alpha = H * (b + 2 * a - b * d) / (2 * rho);
    const beta = H * (b - a + (a + b) * d) / (2 * rho);
    const gamma = H * (-b + a + (a + b) * d) / (2 * rho);
    const delta = H * (2 * b + a - a * d) / (2 * rho);
    const junction = 8 * H * rho / (3 * (d + 3));
    const newtonStep = (s: number, t: number): number => {
      // g(x) = 3x²/4 − 3sx + 3t² − 3t + 2. This unscaled step
      // equals H times the paper's step for g(Hξ) at ξ = junction/H.
      const value = 0.75 * junction ** 2 - 3 * s * junction + 3 * t * t - 3 * t + 2;
      return junction - value / (1.5 * junction - 3 * s);
    };
    const lambda = pointConstruction === 'newton' ? newtonStep(alpha + b * beta, b)
      : 2 * (alpha + b * beta) - (2 / 3) * Math.sqrt(9 * (alpha + b * beta) ** 2 - 9 * b * b + 9 * b - 6);
    const mu = pointConstruction === 'newton' ? newtonStep(delta + a * gamma, a)
      : 2 * (delta + a * gamma) - (2 / 3) * Math.sqrt(9 * (delta + a * gamma) ** 2 - 9 * a * a + 9 * a - 6);
    const global = (u: number, v: number): Point => ({
      x: HEXAGON_VERTICES[4].x + u * (HEXAGON_VERTICES[5].x - HEXAGON_VERTICES[4].x) + v * (HEXAGON_VERTICES[3].x - HEXAGON_VERTICES[4].x),
      y: HEXAGON_VERTICES[4].y + u * (HEXAGON_VERTICES[5].y - HEXAGON_VERTICES[4].y) + v * (HEXAGON_VERTICES[3].y - HEXAGON_VERTICES[4].y),
    });
    coordinates.set('Q-', global(b - beta * lambda, alpha * lambda));
    coordinates.set('Q0', global((2 * b + a - a * d) / (d + 3), (b + 2 * a - b * d) / (d + 3)));
    coordinates.set('Q+', global(delta * mu, a - gamma * mu));
  }
  const innerSymbols: Record<string, string> = { 'Q-': 'A', Q0: 'B', 'Q+': 'C' };
  const points = NINE_POINT_IDS.map((id) => {
    const symbol = pointConstruction === 'newton' ? innerSymbols[id] : undefined;
    const label = id.startsWith('D') ? `common radial point on r${id.slice(1)}`
      : symbol ? `Newton inner point ${symbol}${id === 'Q0' ? ' = Q0' : ''}` : `exact AB frontier ${id}`;
    const point = witness(id, label, coordinates.get(id) ?? null, disabled);
    return symbol ? { ...point, symbol } : point;
  });
  const fitted = fitWitnesses(points);
  const missing = points.filter((point) => point.enabled && point.point === null).map((point) => point.id);
  const status = !domainOk ? domainStatus : fitted.enabledPointCount === 0 ? 'no points selected'
    : missing.length > 0 ? `unavailable at numerical precision: ${missing.join(', ')}` : 'ready';
  return { pointConstruction, a, b, domainOk, domainStatus, cStar, diskRadius, circles, points, ...fitted, strictGap: a + b - 1, localRegionVariant: 'exact', status };
}
