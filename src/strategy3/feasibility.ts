import { findRestrictedAbSource } from '../ab-union/feasibility';
import type { AbUnionDotHandle, AbUnionEdgeDots } from '../ab-union/types';
import type { Point } from '../types';
import { strategy3BoundaryInputs } from './boundary';
import {
  boundaryRelations, boundaryVariables, dotsFromSumRoots, projectSumRoots, sumActivationSeeds,
  sumConstraintSystem, validFixedSums, STRATEGY3_SUM_TOLERANCE, type BoundaryVariables,
} from './constraints';
import { constructBC, constructD, constructNinePoint } from './geometry';
import type { Strategy3Mode } from './state';

export const STRATEGY3_STRICT_MARGIN = 1e-9;
const MOVE_TOLERANCE = 1e-6;
export { STRATEGY3_SUM_TOLERANCE };

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
const lockedFeasibilityCache = new Map<Strategy3Mode, { key: string; result: Strategy3Feasibility }>();

function boundaryKey(edgeDots: readonly AbUnionEdgeDots[]): string {
  return JSON.stringify(edgeDots.map(({ left, right, split }) => [left, right, split]));
}

// This path constructs every witness, but never fits an enclosing triangle.
function checkGeometryFeasibility(mode: Strategy3Mode, edgeDots: readonly AbUnionEdgeDots[]): Strategy3Feasibility {
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

export function checkStrategy3Feasibility(mode: Strategy3Mode, edgeDots: readonly AbUnionEdgeDots[], fixedSums?: readonly (number | null)[]): Strategy3Feasibility {
  if (fixedSums === undefined) return checkGeometryFeasibility(mode, edgeDots);
  const key = `${boundaryKey(edgeDots)}:${JSON.stringify(fixedSums)}`;
  const cached = lockedFeasibilityCache.get(mode);
  if (cached?.key === key) return cached.result;
  const geometry = checkGeometryFeasibility(mode, edgeDots);
  const reasons = [...geometry.reasons];
  if (!validFixedSums(fixedSums)) reasons.push('Expected six finite sum targets from 0 to 2, or unlocked rows.');
  else if (edgeDots.length === 6) fixedSums.forEach((target, index) => {
    if (target !== null && Math.abs(1 - edgeDots[(index + 5) % 6].right + edgeDots[index].left - target) > STRATEGY3_SUM_TOLERANCE) {
      reasons.push(`V${index}: selected boundary sum does not match its locked target.`);
    }
  });
  const result = reasons.length === geometry.reasons.length ? geometry : { ok: false, reasons, sources: geometry.sources };
  lockedFeasibilityCache.set(mode, { key, result });
  return result;
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
  const constraints = boundaryRelations(mode, edgeDots, variables, margin);
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
  fixedSums?: readonly (number | null)[],
): Strategy3MoveResult {
  const initial = checkStrategy3Feasibility(mode, edgeDots, fixedSums);
  const hasLocks = fixedSums?.some((value) => value !== null) === true;
  const variables = boundaryVariables(edgeDots);
  const driver = dot.role === 'right' ? variables.right[dot.edge] : variables.left[dot.edge];
  const original = variables.values[driver];
  const finish = (dots: AbUnionEdgeDots[], feasibility: Strategy3Feasibility, blockedReason: string | null): Strategy3MoveResult => {
    const next = boundaryVariables(dots).values;
    const moved = next.map((position, index) => Math.abs(position - variables.values[index]) > 1e-12);
    if (fixedSums === undefined) feasibilityCache.set(mode, { key: boundaryKey(dots), result: feasibility });
    else lockedFeasibilityCache.set(mode, { key: `${boundaryKey(dots)}:${JSON.stringify(fixedSums)}`, result: feasibility });
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
  const system = hasLocks ? sumConstraintSystem(mode, edgeDots, fixedSums!, STRATEGY3_STRICT_MARGIN) : null;
  if (hasLocks && !system) return finish(unchanged, initial, 'The active sum locks conflict with the boundary constraints.');
  const attempt = (position: number) => {
    let dots: AbUnionEdgeDots[] | null;
    if (system) {
      const drivenComponent = system.component[driver];
      const roots = system.members.map((group) => variables.values[group[0]] - system.offsets[group[0]]);
      roots[drivenComponent] = position - system.offsets[driver];
      const fixed = new Map<number, number>();
      roots.forEach((root, index) => { if (behavior === 'stop' || index === drivenComponent) fixed.set(index, root); });
      const projected = projectSumRoots(system, roots, fixed);
      dots = projected ? dotsFromSumRoots(system, edgeDots, projected, behavior === 'stop' ? drivenComponent : undefined) : null;
    } else dots = behavior === 'adjust-neighbors'
      ? adjustNeighbors(mode, edgeDots, variables, driver, position)
      : edgeDots.map((edge, index) => index !== dot.edge ? { ...edge }
        : dot.role === 'shared' ? { ...edge, left: position, right: position } : { ...edge, [dot.role]: position });
    if (!dots) return { dots: null, feasibility: null, reason: 'Boundary ordering and case bounds block this position.' };
    const feasibility = checkStrategy3Feasibility(mode, dots, fixedSums);
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

export function projectStrategy3SumChange(
  mode: Strategy3Mode, edgeDots: readonly AbUnionEdgeDots[], nextFixedSums: readonly (number | null)[],
): { ok: boolean; edgeDots: AbUnionEdgeDots[]; feasibility: Strategy3Feasibility; reason: string | null } {
  const unchanged = edgeDots.map((edge) => ({ ...edge }));
  const current = checkStrategy3Feasibility(mode, edgeDots, nextFixedSums);
  if (current.ok) return { ok: true, edgeDots: unchanged, feasibility: current, reason: null };
  const failure = (reason: string) => ({ ok: false, edgeDots: unchanged, feasibility: current, reason });
  if (edgeDots.length !== 6 || !validFixedSums(nextFixedSums)) return failure('Invalid boundary sum targets; previous settings were kept.');
  const system = sumConstraintSystem(mode, edgeDots, nextFixedSums, STRATEGY3_STRICT_MARGIN);
  if (!system) return failure('Sum locks conflict with the boundary constraints; previous settings were kept.');
  let best: { edgeDots: AbUnionEdgeDots[]; feasibility: Strategy3Feasibility; score: number } | null = null;
  for (const seed of sumActivationSeeds(system)) {
    const roots = projectSumRoots(system, seed);
    if (!roots) continue;
    const candidate = dotsFromSumRoots(system, edgeDots, roots);
    const feasibility = checkStrategy3Feasibility(mode, candidate, nextFixedSums);
    if (!feasibility.ok) continue;
    const score = boundaryVariables(candidate).values.reduce((sum, value, index) => sum + (value - system.variables.values[index]) ** 2, 0);
    if (!best || score < best.score - 1e-15) best = { edgeDots: candidate, feasibility, score };
  }
  if (!best) return failure('No feasible adjustment found while preserving the selected sum locks; previous settings were kept.');
  lockedFeasibilityCache.set(mode, { key: `${boundaryKey(best.edgeDots)}:${JSON.stringify(nextFixedSums)}`, result: best.feasibility });
  return { ok: true, edgeDots: best.edgeDots, feasibility: best.feasibility, reason: null };
}
