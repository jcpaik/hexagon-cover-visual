import type { AbUnionEdgeDots, AbUnionRegionDefinition } from '../ab-union/types';
import { HEXAGON_VERTICES } from '../hexagon';
import { backwardNeighborCapacity, forwardNeighborCapacity, ownRayCapacity } from '../radialCapacity';
import { buildBC, buildD, evaluateNinePoint, NINE_POINT_IDS, type NinePointEvaluation, type NinePointConstruction, type WitnessCondition, type WitnessEvaluation } from './geometry';

export interface BoundaryRole extends AbUnionRegionDefinition {
  suppliesMidpoint: boolean;
}

export interface BoundaryCapacity {
  own: number | null;
  previous: number | null;
  next: number | null;
  gamma: number | null;
  radial: number | null;
}

export interface BoundaryEvaluation {
  roles: BoundaryRole[];
  capacities: BoundaryCapacity[];
  conditions: WitnessCondition[];
  witness: WitnessEvaluation | NinePointEvaluation;
}

export function strategy3BoundaryInputs(
  mode: 'bc' | 'd' | 'f',
  edgeDots: readonly AbUnionEdgeDots[],
) {
  const roles = edgeDots.map((edge, index): BoundaryRole => {
    const previous = edgeDots[(index + 5) % 6];
    return {
      index, a: 1 - previous.right, b: edge.left,
      restriction: previous.split ? edge.split ? 'both' : 'in' : edge.split ? 'out' : 'ordinary',
      criticality: mode === 'bc' && index === 0 ? 'any'
        : (mode === 'd' && index === 1) || (mode === 'f' && index === 4) ? 'supercritical' : 'non-supercritical',
      suppliesMidpoint: mode === 'd' && index === 0,
      requiredInteriorPoints: mode === 'd' && index === 0 ? [{ x: HEXAGON_VERTICES[1].x / 2, y: HEXAGON_VERTICES[1].y / 2 }] : [],
    };
  });
  const capacities = roles.map((role, index): BoundaryCapacity => {
    const previousRole = roles[(index + 5) % 6];
    const nextRole = roles[(index + 1) % 6];
    const own = ownRayCapacity(role.a, role.b);
    const previous = forwardNeighborCapacity(previousRole.a, previousRole.b);
    const next = backwardNeighborCapacity(nextRole.a, nextRole.b);
    const gamma = own === null ? null : Math.max(own, previous ?? 0, next ?? 0);
    return { own, previous, next, gamma, radial: gamma === null ? null : 1 - gamma };
  });
  const sourceConditions: WitnessCondition[] = [
    { id: 'anchors', group: 'source', label: 'Every anchor pair fits the unit-distance bound a² + ab + b² ≤ 1', ok: capacities.every((row) => row.own !== null) },
    { id: 'strict-traces', group: 'source', label: 'Strict-containment endpoint requirements: a,b < 1 and exact traces > 0', ok: roles.every((role) => role.a < 1 && role.b < 1 && (!(role.restriction === 'in' || role.restriction === 'both') || role.a > 0) && (!(role.restriction === 'out' || role.restriction === 'both') || role.b > 0)) },
    { id: 'nonsupercritical-demands', group: 'source', label: 'Nonsupercritical source roles have lower demands a + b ≤ 1', ok: roles.every((role) => role.criticality !== 'non-supercritical' || role.a + role.b <= 1 + 1e-12) },
  ];
  if (mode === 'bc') {
    // The shared b5 handle is a lower demand, not the actual source reach B5.
    // Failure of this sufficient selected bound does not disprove the actual tail hypothesis.
    sourceConditions.push({ id: 'selected-tail', group: 'source', label: 'Selected tail bound b5 ≥ b0 / 2 (lower-demand check)', ok: roles[5].b >= roles[0].b / 2 - 1e-12 });
  } else if (mode === 'f') {
    const { a, b } = roles[4];
    sourceConditions.push(
      { id: 'critical-demands', group: 'source', label: 'Selected demands at V4 satisfy a4 + b4 > 1', ok: a + b > 1 },
      { id: 'common-pair', group: 'source', label: 'All rows dominate the common pair (1 − b4, 1 − a4)', ok: roles.every((role) => role.a >= 1 - b - 1e-12 && role.b >= 1 - a - 1e-12) },
    );
  }
  return { roles, capacities, sourceConditions };
}

export function evaluateStrategy3Boundary(
  mode: 'bc' | 'd' | 'f',
  edgeDots: readonly AbUnionEdgeDots[],
  disabledIds: readonly string[] = [],
  pointConstruction: NinePointConstruction = 'frontier',
): BoundaryEvaluation {
  const { roles, capacities, sourceConditions } = strategy3BoundaryInputs(mode, edgeDots);
  let witness: WitnessEvaluation | NinePointEvaluation;
  if (mode === 'bc') {
    witness = buildBC({ left: edgeDots[0].left, right: edgeDots[0].right, radial: [capacities[2].radial ?? NaN, capacities[3].radial ?? NaN, capacities[4].radial ?? NaN] }, disabledIds);
    witness.points.forEach((point) => {
      if (point.id.startsWith('D')) point.label = `capacity-derived radial point on r${point.id.slice(1)}`;
    });
    witness.status = `capacity-derived radial bounds; BC covering hypotheses are not verified${witness.points.every((point) => point.enabled) ? '' : '; subset fit uses only selected points'}`;
  } else if (mode === 'd') {
    witness = buildD({ a: roles[0].a, epsilon: capacities[1].radial ?? NaN, beta: roles[5].b }, disabledIds);
    witness.points.find((point) => point.id === 'PT')!.label = 'capacity-derived radial point on r1';
    witness.status = `capacity-derived radial bound; four-point inequalities ${witness.domainOk ? 'met' : 'not met'}${witness.points.every((point) => point.enabled) ? '' : '; subset fit uses only selected points'}`;
  } else {
    const { a, b } = roles[4];
    witness = evaluateNinePoint(a, b, NINE_POINT_IDS.filter((id) => !disabledIds.includes(id)), pointConstruction);
  }
  const conditions = [...('conditions' in witness ? witness.conditions : [
    { id: 'f-domain', group: 'geometry' as const, label: witness.domainStatus, ok: witness.domainOk },
  ]), ...sourceConditions];
  return { roles, capacities, conditions, witness };
}
