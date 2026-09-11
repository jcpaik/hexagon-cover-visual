import {
  type AbUnionCenterMode,
  type AbUnionCoincidenceRole,
  type AbUnionSumConstraintMode,
  type AbUnionTool,
} from '../ab-union/types';
import { type AreaConjQuality } from '../areaConjecture';
import { clampNonNegative, clampStrictEpsUpperBound } from './controllerSnapshot';
import type { CoreCaseTool } from './types';

export function formatTuple(values: number[]): string {
  return `(${values.map((value) => value.toFixed(3)).join(', ')})`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function clampToLocalCMax(value: number, maxValue: number): number {
  return Math.max(0, Math.min(maxValue, value));
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function formatStrictEps(value: number): string {
  return clampNonNegative(value).toFixed(7);
}

export function getStrictEpsStep(upperBound: number): string {
  const safeUpperBound = clampStrictEpsUpperBound(upperBound);
  return Math.max(safeUpperBound / 1000, 1e-9).toString();
}

export function isAbUnionCoincidenceRole(value: unknown): value is AbUnionCoincidenceRole {
  return value === 'shared' || value === 'left' || value === 'right';
}

export function formatAbUnionDegrees(radians: number): string {
  return `${(radians * 180 / Math.PI).toFixed(1)} deg`;
}

export function abUnionCenterLabel(mode: AbUnionCenterMode): string {
  if (mode === 'none') return 'none';
  if (mode === 'circle') return 'circle';
  if (mode === 'local-c') return 'manual c_i hull';
  return 'triangle';
}

export function formatAbUnionValues(label: string, values: number[]): string {
  return `${label} = (${values.map((value) => value.toFixed(4)).join(', ')})`;
}

export function isAreaQuality(value: string): value is AreaConjQuality {
  return value === 'coarse' || value === 'high';
}

export function isAreaSumConstraintMode(value: string | undefined): value is AbUnionSumConstraintMode {
  return value === 'none' || value === 'current' || value === 'one' || value === 'one-plus-delta';
}

export function isMaxAreaParam(value: string | undefined): value is 'a' | 'b' {
  return value === 'a' || value === 'b';
}

export function formatAreaNumber(value: number): string {
  return value.toFixed(6);
}

export function areaConjToolText(tool: AbUnionTool): string {
  if (tool === 'd-mark') return 'd-mark';
  if (tool === 's-mark') return 's-mark';
  if (tool === 'f-mark') return 'f mark';
  return tool[0].toUpperCase() + tool.slice(1);
}

export function coreCaseToolText(tool: CoreCaseTool): string {
  return tool === 'core-point' ? 'Core point' : areaConjToolText(tool);
}

export function countWord(count: number): string {
  if (count === 4) return 'four';
  if (count === 5) return 'five';
  return count.toString();
}
