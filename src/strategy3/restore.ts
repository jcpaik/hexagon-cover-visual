import type { AbUnionEdgeDots } from '../ab-union/types';
import { checkStrategy3Feasibility, STRATEGY3_SUM_TOLERANCE } from './feasibility';
import {
  createDefaultStrategy3State, sanitizeStrategy3State,
  type Strategy3GapLayout, type Strategy3Mode, type Strategy3State, type Strategy3SumConstraints,
} from './state';

export interface Strategy3RestoreReset {
  mode: Strategy3Mode;
  layout: Strategy3GapLayout | null;
  action: 'boundary-reset' | 'locks-cleared';
  reasons: string[];
}

export function prepareStrategy3Restore(next: Strategy3State): {
  state: Strategy3State;
  resets: Strategy3RestoreReset[];
} {
  const state = sanitizeStrategy3State(next);
  const defaults = createDefaultStrategy3State();
  const resets: Strategy3RestoreReset[] = [];
  function prepareLayout(
    mode: Strategy3Mode,
    layout: Strategy3GapLayout | null,
    edgeDots: AbUnionEdgeDots[],
    sumConstraints: Strategy3SumConstraints,
    preset: AbUnionEdgeDots[],
  ): AbUnionEdgeDots[] {
    const feasibility = checkStrategy3Feasibility(mode, edgeDots);
    if (!feasibility.ok) {
      sumConstraints.sumConstraintModes.fill('none');
      sumConstraints.fixedSums.fill(null);
      resets.push({ mode, layout, action: 'boundary-reset', reasons: [...feasibility.reasons] });
      return preset;
    }
    const reasons: string[] = [];
    sumConstraints.sumConstraintModes.forEach((constraintMode, index) => {
      const target = sumConstraints.fixedSums[index];
      const expected = constraintMode === 'one' ? 1 : 1 + sumConstraints.epsilon;
      const consistent = constraintMode === 'none' ? target === null
        : target !== null && (constraintMode === 'current' || target === expected);
      const sum = 1 - edgeDots[(index + 5) % 6].right + edgeDots[index].left;
      if (consistent && (target === null || Math.abs(sum - target) <= STRATEGY3_SUM_TOLERANCE)) return;
      sumConstraints.sumConstraintModes[index] = 'none';
      sumConstraints.fixedSums[index] = null;
      reasons.push(`V${index}: ${consistent ? 'saved sum lock does not match the boundary positions' : 'saved sum setting is inconsistent'}.`);
    });
    if (reasons.length > 0) resets.push({ mode, layout, action: 'locks-cleared', reasons });
    return edgeDots;
  }
  for (const mode of ['bc', 'd'] as const) {
    for (const layout of ['seven', 'eight'] as const) {
      state[mode].layouts[layout] = prepareLayout(mode, layout, state[mode].layouts[layout],
        state[mode].sumConstraints[layout], defaults[mode].layouts[layout]);
    }
  }
  state.f.edgeDots = prepareLayout('f', null, state.f.edgeDots, state.f.sumConstraints, defaults.f.edgeDots);
  return { state, resets };
}
