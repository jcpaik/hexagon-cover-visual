import { findRestrictedAbSource } from '../ab-union/feasibility';
import type { AbUnionDotHandle, AbUnionEdgeDots } from '../ab-union/types';
import type { Point } from '../types';
import { strategy3BoundaryInputs } from './boundary';
import { constructBC, constructD, constructNinePoint } from './geometry';
import type { Strategy3Mode } from './state';

export const STRATEGY3_STRICT_MARGIN = 1e-9;
const MOVE_TOLERANCE = 1e-6;

export interface Strategy3Feasibility {
  ok: boolean;
  reasons: string[];
  sources: Array<Point[] | null>;
}

export interface Strategy3MoveResult {
  edgeDots: AbUnionEdgeDots[];
  acceptedValue: number;
  changed: boolean;
  adjustedNeighbors: number;
  blockedReason: string | null;
  feasibility: Strategy3Feasibility;
}

const feasibilityCache = new Map<Strategy3Mode, { key: string; result: Strategy3Feasibility }>();

function boundaryKey(edgeDots: readonly AbUnionEdgeDots[]): string {
  return JSON.stringify(edgeDots.map(({ left, right, split }) => [left, right, split]));
}

// This path constructs every witness, but never fits an enclosing triangle.
export function checkStrategy3Feasibility(mode: Strategy3Mode, edgeDots: readonly AbUnionEdgeDots[]): Strategy3Feasibility {
  const key = boundaryKey(edgeDots);
  const cached = feasibilityCache.get(mode);
  if (cached?.key === key) return cached.result;
  const reasons: string[] = [];
  const sources: Array<Point[] | null> = Array(6).fill(null);
  const finish = (): Strategy3Feasibility => {
    const result = { ok: reasons.length === 0, reasons: [...new Set(reasons)], sources };
    feasibilityCache.set(mode, { key, result });
    return result;
  };
  const mandatoryGap = mode === 'bc' ? 0 : 5;
  const validLayout = edgeDots.length === 6 && edgeDots.every((edge, index) =>
    Number.isFinite(edge.left) && Number.isFinite(edge.right)
    && edge.left >= 0 && edge.left <= edge.right && edge.right <= 1
    && (edge.split || edge.left === edge.right)
    && (mode === 'f' ? !edge.split : index === mandatoryGap ? edge.split : index === 0 || index === 5 || !edge.split),
  );
  if (!validLayout) {
    reasons.push('Boundary positions must preserve the six-edge layout and ordered gap endpoints.');
    return finish();
  }
  const { roles, capacities, sourceConditions } = strategy3BoundaryInputs(mode, edgeDots);
  reasons.push(...sourceConditions.filter((condition) => !condition.ok).map((condition) => condition.label));
  const margin = STRATEGY3_STRICT_MARGIN;
  if (!roles.every((role) => role.a <= 1 - margin && role.b <= 1 - margin
    && (!(role.restriction === 'in' || role.restriction === 'both') || role.a >= margin)
    && (!(role.restriction === 'out' || role.restriction === 'both') || role.b >= margin))) {
    reasons.push('Strict boundary reaches need a 1e-9 margin.');
  }
  if (mode === 'bc' || mode === 'd') {
    const construction = mode === 'bc'
      ? constructBC({ left: edgeDots[0].left, right: edgeDots[0].right, radial: [capacities[2].radial ?? NaN, capacities[3].radial ?? NaN, capacities[4].radial ?? NaN] })
      : constructD({ a: roles[0].a, epsilon: capacities[1].radial ?? NaN, beta: roles[5].b });
    reasons.push(...construction.conditions.filter((condition) => !condition.ok).map((condition) => condition.label));
    const radial = mode === 'bc' ? [2, 3, 4].map((index) => capacities[index].radial) : [capacities[1].radial];
    if (!radial.every((value) => value !== null && value >= margin && (mode !== 'bc' || value <= 1 - margin))) {
      reasons.push('Strict radial witness coordinates need a 1e-9 margin.');
    }
    if (!construction.points.every((point) => point.point !== null)) reasons.push('Every witness coordinate must be finite.');
  } else {
    const { a, b } = roles[4];
    if (!(a >= margin && b >= margin && a <= 1 - margin && b <= 1 - margin
      && a + b >= 1 + margin && a * a + a * b + b * b <= 1 - margin)) {
      reasons.push('Case F needs a 1e-9 margin inside its strict sum and anchor-ellipse bounds.');
    }
    for (const kind of ['frontier', 'newton'] as const) {
      const construction = constructNinePoint(a, b, undefined, kind);
      if (!construction.domainOk) reasons.push(construction.domainStatus);
      if (!construction.points.every((point) => point.point !== null)) reasons.push(`Every ${kind} witness coordinate must be finite.`);
    }
  }
  roles.forEach((role, index) => {
    sources[index] = findRestrictedAbSource(role);
    if (sources[index] === null) reasons.push(`V${index}: no feasible restricted source triangle was found.`);
  });
  return finish();
}

interface BoundaryVariables {
  values: number[];
  left: number[];
  right: number[];
}

function boundaryVariables(edgeDots: readonly AbUnionEdgeDots[]): BoundaryVariables {
  const values: number[] = [], left: number[] = [], right: number[] = [];
  edgeDots.forEach((edge) => {
    left.push(values.length);
    values.push(edge.left);
    right.push(edge.split ? values.length : values.length - 1);
    if (edge.split) values.push(edge.right);
  });
  return { values, left, right };
}

// Each relation is x_left <= scale * x_right + offset. Propagating bounds
// from the edited handle leaves unrelated values untouched, then clamps only
// the neighbors forced by the ordering, tail, or common-pair constraints.
function adjustNeighbors(
  mode: Strategy3Mode, edgeDots: readonly AbUnionEdgeDots[], variables: BoundaryVariables, driver: number, value: number,
): AbUnionEdgeDots[] | null {
  const margin = STRATEGY3_STRICT_MARGIN;
  if (value < margin || value > 1 - margin) return null;
  const { values, left, right } = variables;
  const lower = values.map(() => margin), upper = values.map(() => 1 - margin);
  lower[driver] = upper[driver] = value;
  const constraints: Array<[number, number, number, number]> = [];
  for (let index = 0; index < 6; index++) {
    if (edgeDots[index].split) constraints.push([left[index], right[index], 1, 0]);
    const exceptional = mode === 'bc' ? 0 : mode === 'd' ? 1 : 4;
    if (index !== exceptional) constraints.push([left[index], right[(index + 5) % 6], 1, 0]);
  }
  if (mode === 'bc') constraints.push([left[0], left[5], 2, 0]);
  if (mode === 'f') {
    for (let index = 0; index < 6; index++) {
      constraints.push([right[index], left[4], 1, 0], [right[3], left[index], 1, 0]);
    }
    constraints.push([right[3], left[4], 1, -margin]);
  }
  for (let pass = 0; pass < values.length * 2; pass++) {
    let changed = false;
    for (const [first, second, scale, offset] of constraints) {
      const nextUpper = Math.min(upper[first], scale * upper[second] + offset);
      const nextLower = Math.max(lower[second], (lower[first] - offset) / scale);
      changed ||= nextUpper !== upper[first] || nextLower !== lower[second];
      upper[first] = nextUpper;
      lower[second] = nextLower;
      if (lower[first] > upper[first] || lower[second] > upper[second]) return null;
    }
    if (!changed) break;
  }
  const projected = values.map((original, index) => Math.max(lower[index], Math.min(upper[index], original)));
  return edgeDots.map((edge, index) => ({ ...edge, left: projected[left[index]], right: projected[right[index]] }));
}

export function projectStrategy3Move(
  mode: Strategy3Mode,
  edgeDots: readonly AbUnionEdgeDots[],
  dot: AbUnionDotHandle,
  value: number,
  behavior: 'stop' | 'adjust-neighbors',
): Strategy3MoveResult {
  const initial = checkStrategy3Feasibility(mode, edgeDots);
  const variables = boundaryVariables(edgeDots);
  const driver = dot.role === 'right' ? variables.right[dot.edge] : variables.left[dot.edge];
  const original = variables.values[driver];
  const finish = (dots: AbUnionEdgeDots[], feasibility: Strategy3Feasibility, blockedReason: string | null): Strategy3MoveResult => {
    const next = boundaryVariables(dots).values;
    const moved = next.map((position, index) => Math.abs(position - variables.values[index]) > 1e-12);
    feasibilityCache.set(mode, { key: boundaryKey(dots), result: feasibility });
    return {
      edgeDots: dots, acceptedValue: next[driver], changed: moved.some(Boolean),
      adjustedNeighbors: moved.filter((changed, index) => changed && index !== driver).length,
      blockedReason, feasibility,
    };
  };
  const unchanged = edgeDots.map((edge) => ({ ...edge }));
  if (!initial.ok) return finish(unchanged, initial, initial.reasons[0]);
  if (!Number.isFinite(value) || !Number.isInteger(dot.edge) || dot.edge < 0 || dot.edge > 5
    || (edgeDots[dot.edge].split ? dot.role === 'shared' : dot.role !== 'shared')) {
    return finish(unchanged, initial, 'Select a boundary handle and a finite position.');
  }
  const target = Math.max(0, Math.min(1, value));
  const attempt = (position: number) => {
    const dots = behavior === 'adjust-neighbors'
      ? adjustNeighbors(mode, edgeDots, variables, driver, position)
      : edgeDots.map((edge, index) => index !== dot.edge ? { ...edge }
        : dot.role === 'shared' ? { ...edge, left: position, right: position } : { ...edge, [dot.role]: position });
    if (!dots) return { dots: null, feasibility: null, reason: 'Boundary ordering and case bounds block this position.' };
    const feasibility = checkStrategy3Feasibility(mode, dots);
    return { dots, feasibility, reason: feasibility.reasons[0] ?? null };
  };
  const requested = attempt(target);
  if (requested.dots && requested.feasibility?.ok) return finish(requested.dots, requested.feasibility, null);
  let low = 0, high = 1;
  let bestDots = unchanged, bestFeasibility = initial;
  for (let step = 0; step < 32 && Math.abs((high - low) * (target - original)) > MOVE_TOLERANCE; step++) {
    const fraction = (low + high) / 2;
    const candidate = attempt(original + fraction * (target - original));
    if (candidate.dots && candidate.feasibility?.ok) {
      low = fraction;
      bestDots = candidate.dots;
      bestFeasibility = candidate.feasibility;
    } else high = fraction;
  }
  return finish(bestDots, bestFeasibility, requested.reason);
}
