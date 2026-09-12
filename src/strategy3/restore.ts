import { checkStrategy3Feasibility } from './feasibility';
import {
  createDefaultStrategy3State, sanitizeStrategy3State,
  type Strategy3GapLayout, type Strategy3Mode, type Strategy3State,
} from './state';

export interface Strategy3RestoreReset {
  mode: Strategy3Mode;
  layout: Strategy3GapLayout | null;
  reasons: string[];
}

export function prepareStrategy3Restore(next: Strategy3State): {
  state: Strategy3State;
  resets: Strategy3RestoreReset[];
} {
  const state = sanitizeStrategy3State(next);
  const defaults = createDefaultStrategy3State();
  const resets: Strategy3RestoreReset[] = [];
  for (const mode of ['bc', 'd'] as const) {
    for (const layout of ['seven', 'eight'] as const) {
      const feasibility = checkStrategy3Feasibility(mode, state[mode].layouts[layout]);
      if (feasibility.ok) continue;
      state[mode].layouts[layout] = defaults[mode].layouts[layout];
      resets.push({ mode, layout, reasons: [...feasibility.reasons] });
    }
  }
  const feasibility = checkStrategy3Feasibility('f', state.f.edgeDots);
  if (!feasibility.ok) {
    state.f.edgeDots = defaults.f.edgeDots;
    resets.push({ mode: 'f', layout: null, reasons: [...feasibility.reasons] });
  }
  return { state, resets };
}
