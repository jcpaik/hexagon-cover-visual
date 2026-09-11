import { createDefaultFreeState } from '../freeGeometry';
import type { FreeTriangleId } from '../freeTypes';
import type { Point } from '../types';
import {
  DEFAULT_BC_PARAMETERS,
  DEFAULT_D_PARAMETERS,
  type BCParameters,
  type DParameters,
} from './geometry';

export const STRATEGY3_TRIANGLE_IDS = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5'] as const;
export type VTriangleId = Exclude<FreeTriangleId, 'C'>;
export type Strategy3Source = 'parameters' | 'triangles';

export interface TrianglePose {
  id: VTriangleId;
  center: Point;
  angle: number;
}

interface ConstructionState<Parameters> {
  source: Strategy3Source;
  parameters: Parameters;
  triangles: TrianglePose[];
  selectedTriangleId: VTriangleId;
  disabledPointIds: string[];
}

export interface Strategy3State {
  bc: ConstructionState<BCParameters>;
  d: ConstructionState<DParameters>;
}

export function createDefaultStrategy3State(): Strategy3State {
  function triangles(): TrianglePose[] {
    return createDefaultFreeState().triangles.filter((triangle) => triangle.id !== 'C').map((triangle) => ({
      id: triangle.id as VTriangleId,
      center: { ...triangle.center },
      angle: triangle.angle,
    }));
  }
  return {
    bc: {
      source: 'parameters',
      parameters: { ...DEFAULT_BC_PARAMETERS, radial: [...DEFAULT_BC_PARAMETERS.radial] },
      triangles: triangles(),
      selectedTriangleId: 'V0',
      disabledPointIds: [],
    },
    d: {
      source: 'parameters',
      parameters: { ...DEFAULT_D_PARAMETERS },
      triangles: triangles(),
      selectedTriangleId: 'V0',
      disabledPointIds: [],
    },
  };
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Strategy 3 ${label}.`);
  }
  return value as Record<string, unknown>;
}

function parameter(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid Strategy 3 ${label}; expected a number from 0 to 1.`);
  }
  return value;
}

function sanitizeConstruction<Parameters>(
  value: unknown,
  defaults: ConstructionState<Parameters>,
  pointIds: readonly string[],
  parseParameters: (value: unknown) => Parameters,
): ConstructionState<Parameters> {
  if (value === undefined) return defaults;
  const raw = object(value, 'construction');
  if (raw.source !== 'parameters' && raw.source !== 'triangles') {
    throw new Error('Invalid Strategy 3 source.');
  }
  if (!Array.isArray(raw.triangles) || raw.triangles.length !== 6) {
    throw new Error('Strategy 3 requires six V triangle poses.');
  }
  const poses = raw.triangles.map((value) => object(value, 'triangle pose'));
  const triangles = STRATEGY3_TRIANGLE_IDS.map((id): TrianglePose => {
    const matches = poses.filter((pose) => pose.id === id);
    if (matches.length !== 1) throw new Error('Strategy 3 requires one pose for each V triangle.');
    const pose = matches[0];
    const center = object(pose.center, 'triangle center');
    if (typeof center.x !== 'number' || !Number.isFinite(center.x)
      || typeof center.y !== 'number' || !Number.isFinite(center.y)
      || typeof pose.angle !== 'number' || !Number.isFinite(pose.angle)) {
      throw new Error('Invalid Strategy 3 triangle pose.');
    }
    return { id, center: { x: center.x, y: center.y }, angle: pose.angle };
  });
  if (!STRATEGY3_TRIANGLE_IDS.includes(raw.selectedTriangleId as VTriangleId)) {
    throw new Error('Invalid Strategy 3 selected triangle.');
  }
  if (!Array.isArray(raw.disabledPointIds)
    || !raw.disabledPointIds.every((id): id is string => typeof id === 'string' && pointIds.includes(id))) {
    throw new Error('Invalid Strategy 3 disabled point IDs.');
  }
  return {
    source: raw.source,
    parameters: parseParameters(raw.parameters),
    triangles,
    selectedTriangleId: raw.selectedTriangleId as VTriangleId,
    disabledPointIds: Array.from(new Set(raw.disabledPointIds)),
  };
}

export function sanitizeStrategy3State(value: unknown): Strategy3State {
  const defaults = createDefaultStrategy3State();
  if (value === undefined) return defaults;
  const raw = object(value, 'state');
  return {
    bc: sanitizeConstruction(raw.bc, defaults.bc, ['M0', 'G0', 'G1', 'D2', 'D3', 'D4'], (value) => {
      const parameters = object(value, 'BC parameters');
      if (!Array.isArray(parameters.radial) || parameters.radial.length !== 3) {
        throw new Error('Strategy 3 BC requires three radial parameters.');
      }
      return {
        left: parameter(parameters.left, 'BC left'),
        right: parameter(parameters.right, 'BC right'),
        radial: parameters.radial.map((value) => parameter(value, 'BC radial')) as [number, number, number],
      };
    }),
    d: sanitizeConstruction(raw.d, defaults.d, ['O', 'PT', 'G0', 'G1'], (value) => {
      const parameters = object(value, 'D parameters');
      return {
        a: parameter(parameters.a, 'D a'),
        epsilon: parameter(parameters.epsilon, 'D epsilon'),
        beta: parameter(parameters.beta, 'D beta'),
      };
    }),
  };
}
