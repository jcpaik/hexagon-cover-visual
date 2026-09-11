import type { CoverChainDirection } from '../cover';
import type { PerimeterIntersectionInterval } from '../triangle';

export type CoreCaseTool = 'move' | 'add' | 'delete' | 'core-point';

export interface ChainDescriptor {
  activeCe: boolean;
  direction: CoverChainDirection;
  vertexOrder: number[];
  localCs: number[];
  start: number;
  defaultStart: number;
  ceStartKey: string | null;
  target: number | null;
  values: number[];
  finalValue: number;
  passes: boolean | null;
  selectedInterval: PerimeterIntersectionInterval | null;
}
