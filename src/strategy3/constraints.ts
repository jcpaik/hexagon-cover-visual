import type { AbUnionEdgeDots } from '../ab-union/types';
import type { Strategy3Mode } from './state';

export const STRATEGY3_SUM_TOLERANCE = 1e-10;

export interface BoundaryVariables {
  values: number[];
  left: number[];
  right: number[];
}

export function boundaryVariables(edgeDots: readonly AbUnionEdgeDots[]): BoundaryVariables {
  const values: number[] = [], left: number[] = [], right: number[] = [];
  edgeDots.forEach((edge) => {
    left.push(values.length);
    values.push(edge.left);
    right.push(edge.split ? values.length : values.length - 1);
    if (edge.split) values.push(edge.right);
  });
  return { values, left, right };
}

// x_first <= scale * x_second + offset, in independent physical handles.
export function boundaryRelations(mode: Strategy3Mode, edgeDots: readonly AbUnionEdgeDots[], variables: BoundaryVariables, margin: number): Array<[number, number, number, number]> {
  const { left, right } = variables;
  const relations: Array<[number, number, number, number]> = [];
  for (let index = 0; index < 6; index++) {
    if (edgeDots[index].split) relations.push([left[index], right[index], 1, 0]);
    const exceptional = mode === 'bc' ? 0 : mode === 'd' ? 1 : 4;
    if (index !== exceptional) relations.push([left[index], right[(index + 5) % 6], 1, 0]);
  }
  if (mode === 'bc') relations.push([left[0], left[5], 2, 0]);
  if (mode === 'f') {
    for (let index = 0; index < 6; index++) {
      relations.push([right[index], left[4], 1, 0], [right[3], left[index], 1, 0]);
    }
    relations.push([right[3], left[4], 1, -margin]);
  }
  return relations;
}

interface LinearBound { coefficients: number[]; upper: number }

export interface SumConstraintSystem {
  variables: BoundaryVariables;
  component: number[];
  offsets: number[];
  members: number[][];
  means: number[];
  lower: number[];
  upper: number[];
  bounds: LinearBound[];
}

export function validFixedSums(fixedSums: readonly (number | null)[]): boolean {
  return fixedSums.length === 6 && fixedSums.every((value) => value === null || (Number.isFinite(value) && value >= 0 && value <= 2));
}

export function sumConstraintSystem(mode: Strategy3Mode, edgeDots: readonly AbUnionEdgeDots[], fixedSums: readonly (number | null)[], margin: number): SumConstraintSystem | null {
  if (!validFixedSums(fixedSums)) return null;
  const variables = boundaryVariables(edgeDots);
  const graph = variables.values.map(() => [] as Array<{ to: number; offset: number }>);
  fixedSums.forEach((sum, index) => {
    if (sum === null) return;
    const from = variables.right[(index + 5) % 6], to = variables.left[index];
    graph[from].push({ to, offset: sum - 1 });
    graph[to].push({ to: from, offset: 1 - sum });
  });
  const component = variables.values.map(() => -1), offsets = variables.values.map(() => 0);
  const members: number[][] = [];
  for (let start = 0; start < graph.length; start++) {
    if (component[start] !== -1) continue;
    component[start] = members.length;
    const group: number[] = [], pending = [start];
    while (pending.length > 0) {
      const current = pending.pop()!;
      group.push(current);
      for (const relation of graph[current]) {
        const offset = offsets[current] + relation.offset;
        if (component[relation.to] === -1) {
          component[relation.to] = component[start];
          offsets[relation.to] = offset;
          pending.push(relation.to);
        } else if (Math.abs(offsets[relation.to] - offset) > STRATEGY3_SUM_TOLERANCE) return null;
      }
    }
    members.push(group.sort((a, b) => a - b));
  }
  const means = members.map((group) => group.reduce((sum, index) => sum + variables.values[index] - offsets[index], 0) / group.length);
  const lower = members.map((group) => Math.max(...group.map((index) => margin - offsets[index])));
  const upper = members.map((group) => Math.min(...group.map((index) => 1 - margin - offsets[index])));
  if (lower.some((value, index) => value > upper[index])) return null;
  const bounds: LinearBound[] = [];
  for (let index = 0; index < members.length; index++) {
    const coefficients = members.map((_, other) => other === index ? 1 : 0);
    bounds.push({ coefficients, upper: upper[index] }, { coefficients: coefficients.map((value) => -value), upper: -lower[index] });
  }
  for (const [first, second, scale, offset] of boundaryRelations(mode, edgeDots, variables, margin)) {
    const coefficients = members.map(() => 0);
    coefficients[component[first]] += 1;
    coefficients[component[second]] -= scale;
    const bound = offset - offsets[first] + scale * offsets[second];
    if (coefficients.every((value) => value === 0)) {
      if (bound < -1e-12) return null;
    } else bounds.push({ coefficients, upper: bound });
  }
  return { variables, component, offsets, members, means, lower, upper, bounds };
}

// Weighted Dykstra projection. Fixed roots are eliminated, so neither the
// dragged handle nor its equality-linked partners drift during projection.
export function projectSumRoots(system: SumConstraintSystem, seed: readonly number[], fixed: ReadonlyMap<number, number> = new Map()): number[] | null {
  const roots = [...seed];
  for (const [index, value] of fixed) roots[index] = value;
  const free = roots.map((_, index) => index).filter((index) => !fixed.has(index));
  const constraints = system.bounds.map((bound) => {
    const coefficients = free.map((index) => bound.coefficients[index]);
    const upper = bound.upper - [...fixed].reduce((sum, [index, value]) => sum + bound.coefficients[index] * value, 0);
    const denominator = coefficients.reduce((sum, value, index) => sum + value * value / system.members[free[index]].length, 0);
    return { coefficients, upper, denominator, correction: 0 };
  });
  if (constraints.some((bound) => bound.denominator === 0 && bound.upper < -1e-12)) return null;
  const values = free.map((index) => roots[index]);
  let residual = Infinity;
  for (let sweep = 0; sweep < 256; sweep++) {
    const previous = [...values];
    for (const bound of constraints) {
      if (bound.denominator === 0) continue;
      const excess = bound.coefficients.reduce((sum, coefficient, index) => sum + coefficient * values[index], -bound.upper)
        + bound.correction * bound.denominator;
      const correction = Math.max(0, excess / bound.denominator);
      values.forEach((_, index) => { values[index] += (bound.correction - correction) * bound.coefficients[index] / system.members[free[index]].length; });
      bound.correction = correction;
    }
    residual = Math.max(0, ...constraints.map((bound) => bound.coefficients.reduce((sum, coefficient, index) => sum + coefficient * values[index], -bound.upper)));
    if (residual <= 1e-13 && values.every((value, index) => Math.abs(value - previous[index]) <= 1e-12)) break;
  }
  if (residual > STRATEGY3_SUM_TOLERANCE || values.some((value) => !Number.isFinite(value))) return null;
  free.forEach((index, position) => { roots[index] = values[position]; });
  return roots;
}

export function dotsFromSumRoots(system: SumConstraintSystem, edgeDots: readonly AbUnionEdgeDots[], roots: readonly number[], movingComponent?: number): AbUnionEdgeDots[] {
  const values = system.variables.values.map((original, index) => movingComponent !== undefined && system.component[index] !== movingComponent
    ? original : roots[system.component[index]] + system.offsets[index]);
  return edgeDots.map((edge, index) => ({ ...edge, left: values[system.variables.left[index]], right: values[system.variables.right[index]] }));
}

// One balanced placement, each old-handle anchor, and five interval positions
// per free component: at most 49 deterministic local seeds for eight handles.
export function sumActivationSeeds(system: SumConstraintSystem): number[][] {
  const seeds = [[...system.means]];
  system.variables.values.forEach((value, index) => {
    const seed = [...system.means];
    seed[system.component[index]] = value - system.offsets[index];
    seeds.push(seed);
  });
  system.members.forEach((_, index) => {
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const seed = [...system.means];
      seed[index] = system.lower[index] + fraction * (system.upper[index] - system.lower[index]);
      seeds.push(seed);
    }
  });
  return [...new Map(seeds.map((seed) => [JSON.stringify(seed), seed])).values()];
}
