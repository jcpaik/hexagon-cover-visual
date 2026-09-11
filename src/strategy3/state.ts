import type { AbUnionEdgeDots } from '../ab-union/types';
import { NINE_POINT_IDS } from './geometry';

export type Strategy3Mode = 'bc' | 'd' | 'f';
export type Strategy3GapLayout = 'seven' | 'eight';

interface GapConstructionState {
  layout: Strategy3GapLayout;
  layouts: Record<Strategy3GapLayout, AbUnionEdgeDots[]>;
  disabledPointIds: string[];
  regionVisible: boolean[];
}

export interface Strategy3State {
  bc: GapConstructionState;
  d: GapConstructionState;
  f: {
    edgeDots: AbUnionEdgeDots[];
    disabledPointIds: string[];
    regionVisible: boolean[];
    showDisk: boolean;
  };
}

function dots(values: Array<number | [number, number]>): AbUnionEdgeDots[] {
  return values.map((value) => Array.isArray(value)
    ? { left: value[0], right: value[1], split: true }
    : { left: value, right: value, split: false });
}

export function createDefaultStrategy3State(): Strategy3State {
  return {
    bc: {
      layout: 'seven',
      layouts: {
        seven: dots([[0.35, 0.65], 0.605, 0.555, 0.505, 0.455, 0.405]),
        eight: dots([[0.42, 0.58], 0.555, 0.505, 0.455, 0.405, [0.3, 0.5]]),
      },
      disabledPointIds: [],
      regionVisible: Array(6).fill(true),
    },
    d: {
      layout: 'seven',
      layouts: {
        seven: dots([0.3, 0.41, 0.36, 0.31, 0.26, [0.2, 0.8]]),
        eight: dots([[0.68, 0.70], 0.74, 0.65, 0.56, 0.47, [0.2, 0.8]]),
      },
      disabledPointIds: [],
      regionVisible: Array(6).fill(true),
    },
    f: {
      edgeDots: dots([0.528, 0.502, 0.476, 0.45, 0.58, 0.554]),
      disabledPointIds: [],
      regionVisible: Array(6).fill(true),
      showDisk: true,
    },
  };
}

export function strategy3EdgeDots(state: Strategy3State, mode: Strategy3Mode): AbUnionEdgeDots[] {
  if (mode === 'f') return state.f.edgeDots;
  const construction = state[mode];
  return construction.layouts[construction.layout];
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Strategy 3 ${label}.`);
  }
  return value as Record<string, unknown>;
}

function parameter(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('Invalid Strategy 3 boundary position; expected a number from 0 to 1.');
  }
  return value;
}

function sanitizeDots(value: unknown, splitEdges: readonly number[]): AbUnionEdgeDots[] {
  if (!Array.isArray(value) || value.length !== 6) {
    throw new Error('Strategy 3 requires six boundary edges.');
  }
  return value.map((value, index) => {
    const raw = object(value, 'boundary edge');
    const left = parameter(raw.left);
    const right = parameter(raw.right);
    const split = splitEdges.includes(index);
    if (raw.split !== split || left > right || (!split && left !== right)) {
      throw new Error('Invalid Strategy 3 boundary topology.');
    }
    return { left, right, split };
  });
}

function sanitizePointIds(value: unknown, pointIds: readonly string[]): string[] {
  if (!Array.isArray(value)
    || !value.every((id): id is string => typeof id === 'string' && pointIds.includes(id))) {
    throw new Error('Invalid Strategy 3 disabled point IDs.');
  }
  return Array.from(new Set(value));
}

function sanitizeRegionVisible(value: unknown): boolean[] {
  if (value === undefined) return Array(6).fill(true);
  if (!Array.isArray(value) || value.length !== 6
    || !Array.from(value).every((visible) => typeof visible === 'boolean')) {
    throw new Error('Invalid Strategy 3 region visibility; expected six booleans.');
  }
  return [...value];
}

function sanitizeGapConstruction(
  value: unknown,
  defaults: GapConstructionState,
  mandatoryGap: number,
  pointIds: readonly string[],
): GapConstructionState {
  if (value === undefined) return defaults;
  const raw = object(value, 'construction');
  if (raw.layout !== 'seven' && raw.layout !== 'eight') {
    throw new Error('Invalid Strategy 3 boundary layout.');
  }
  const layouts = object(raw.layouts, 'boundary layouts');
  return {
    layout: raw.layout,
    layouts: {
      seven: sanitizeDots(layouts.seven, [mandatoryGap]),
      eight: sanitizeDots(layouts.eight, [0, 5]),
    },
    disabledPointIds: sanitizePointIds(raw.disabledPointIds, pointIds),
    regionVisible: sanitizeRegionVisible(raw.regionVisible),
  };
}

export function sanitizeStrategy3State(value: unknown): Strategy3State {
  const defaults = createDefaultStrategy3State();
  if (value === undefined) return defaults;
  const raw = object(value, 'state');
  const f = raw.f === undefined ? defaults.f : object(raw.f, 'F construction');
  if (typeof f.showDisk !== 'boolean') throw new Error('Invalid Strategy 3 disk visibility.');
  return {
    bc: sanitizeGapConstruction(raw.bc, defaults.bc, 0, ['M0', 'G0', 'G1', 'D2', 'D3', 'D4']),
    d: sanitizeGapConstruction(raw.d, defaults.d, 5, ['O', 'PT', 'G0', 'G1']),
    f: {
      edgeDots: sanitizeDots(f.edgeDots, []),
      disabledPointIds: sanitizePointIds(f.disabledPointIds, NINE_POINT_IDS),
      regionVisible: sanitizeRegionVisible(f.regionVisible),
      showDisk: f.showDisk,
    },
  };
}
