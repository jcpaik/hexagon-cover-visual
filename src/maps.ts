const EPS = 1e-9;
const BRACKET_SAMPLES = 512;
const BINARY_SEARCH_STEPS = 48;
type OrderedAdmissiblePredicate = (
  a: number,
  b: number,
  c: number,
  strictEps: number,
) => boolean;

export const DEFAULT_ADMISSIBLE_ORDERED_SOURCE = `const strict = Math.max(0, STRICT_EPS);
const sum = a + b;
const circle = a * a + a * b + b * b;
if (circle > 1 - strict + EPS) {
  return false;
}

const transition = sum ** 4 - sum * sum + a * b;
const cell1 =
  sum <= 1 - strict + EPS &&
  transition <= -strict + EPS &&
  c ** 4 - c * c + a * c - a * a <= -strict + EPS;
const cell2 =
  sum <= 1 - strict + EPS &&
  transition >= strict - EPS &&
  (sum * sum - 1) * c * c + b * c - b * b <= -strict + EPS;
const cell3 =
  sum >= 1 + strict - EPS &&
  c <= 0.5 - strict + EPS &&
  (a * a - 1) * c * c + (2 * a * b * b + b) * c + (b ** 4 - b * b) <= -strict + EPS;

return cell1 || cell2 || cell3;`;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampNonNegative(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, value);
}

function circleArcBound(a: number): number {
  const disc = Math.max(0, 4 - 3 * a * a);
  return clamp01((-a + Math.sqrt(disc)) / 2);
}

let strictCheckEnabled = false;
let strictEps = 0;

function defaultAdmissibleOrdered(
  a: number,
  b: number,
  c: number,
  strictInput: number,
): boolean {
  const strict = clampNonNegative(strictInput);
  const sum = a + b;
  const circle = a * a + a * b + b * b;
  if (circle > 1 - strict + EPS) {
    return false;
  }

  const transition = sum ** 4 - sum * sum + a * b;
  const cell1 =
    sum <= 1 - strict + EPS &&
    transition <= -strict + EPS &&
    c ** 4 - c * c + a * c - a * a <= -strict + EPS;
  const cell2 =
    sum <= 1 - strict + EPS &&
    transition >= strict - EPS &&
    (sum * sum - 1) * c * c + b * c - b * b <= -strict + EPS;
  const cell3 =
    sum >= 1 + strict - EPS &&
    c <= 0.5 - strict + EPS &&
    (a * a - 1) * c * c + (2 * a * b * b + b) * c + (b ** 4 - b * b) <= -strict + EPS;

  return cell1 || cell2 || cell3;
}

let orderedAdmissiblePredicate: OrderedAdmissiblePredicate = defaultAdmissibleOrdered;
let orderedAdmissibleSource = DEFAULT_ADMISSIBLE_ORDERED_SOURCE;
let hasCustomOrderedAdmissibleSource = false;

export function isStrictCheckEnabled(): boolean {
  return strictCheckEnabled;
}

export function setStrictCheckEnabled(enabled: boolean): void {
  strictCheckEnabled = enabled;
}

export function getStrictEps(): number {
  return strictEps;
}

export function setStrictEps(value: number): void {
  strictEps = clampNonNegative(value);
}

export function getEffectiveStrictEps(): number {
  return strictCheckEnabled ? strictEps : 0;
}

function admissibleOrdered(aInput: number, bInput: number, localCInput: number): boolean {
  const a = clamp01(aInput);
  const b = clamp01(bInput);
  const c = clamp01(localCInput);
  const strict = getEffectiveStrictEps();

  if (a > b + EPS) {
    return false;
  }

  if (strict > 0 && b - a < strict - EPS) {
    return false;
  }

  return orderedAdmissiblePredicate(a, b, c, strict);
}

export function getAdmissibleOrderedSource(): string {
  return orderedAdmissibleSource;
}

export function isCustomAdmissibleOrderedSourceActive(): boolean {
  return hasCustomOrderedAdmissibleSource;
}

export function resetAdmissibleOrderedSource(): void {
  orderedAdmissiblePredicate = defaultAdmissibleOrdered;
  orderedAdmissibleSource = DEFAULT_ADMISSIBLE_ORDERED_SOURCE;
  hasCustomOrderedAdmissibleSource = false;
}

export function setAdmissibleOrderedSource(source: string): { ok: true } | { ok: false; error: string } {
  try {
    const compiled = new Function(
      'a',
      'b',
      'c',
      'EPS',
      'STRICT_EPS',
      'clamp01',
      `"use strict";\n${source}`,
    ) as (
      a: number,
      b: number,
      c: number,
      eps: number,
      strictEps: number,
      clamp: typeof clamp01,
    ) => unknown;

    const candidate: OrderedAdmissiblePredicate = (a, b, c, strictEpsValue) =>
      Boolean(compiled(a, b, c, EPS, strictEpsValue, clamp01));

    candidate(0.1, 0.2, 0.3, getEffectiveStrictEps());
    candidate(0.4, 0.4, 0.1, getEffectiveStrictEps());

    orderedAdmissiblePredicate = candidate;
    orderedAdmissibleSource = source;
    hasCustomOrderedAdmissibleSource = true;
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown compile error',
    };
  }
}

export function admissible(
  aInput: number,
  bInput: number,
  localCInput: number,
): boolean {
  const a = clamp01(aInput);
  const b = clamp01(bInput);
  const c = clamp01(localCInput);

  if (a <= b + EPS) {
    return admissibleOrdered(a, b, c);
  }

  return admissibleOrdered(b, a, c);
}

export function maxAdmissibleCoverage(
  aInput: number,
  localCInput: number,
): number {
  const a = clamp01(aInput);
  const localC = clamp01(localCInput);
  const upper = circleArcBound(a);

  if (upper <= EPS) {
    return admissible(a, 0, localC) ? 0 : 0;
  }

  if (admissible(a, upper, localC)) {
    return upper;
  }

  const step = upper / BRACKET_SAMPLES;
  let lo = -1;
  let hi = upper;

  for (let i = BRACKET_SAMPLES - 1; i >= 0; i--) {
    const b = step * i;
    if (admissible(a, b, localC)) {
      lo = b;
      hi = Math.min(upper, b + step);
      break;
    }
  }

  if (lo < 0) {
    return 0;
  }

  for (let i = 0; i < BINARY_SEARCH_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (admissible(a, mid, localC)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return clamp01(lo);
}

export function gAtLocalC(localCInput: number, aInput: number): number {
  const localC = clamp01(localCInput);
  const a = clamp01(aInput);
  return clamp01(1 + getEffectiveStrictEps() - maxAdmissibleCoverage(a, localC));
}

export function gAtGamma(gammaInput: number, aInput: number): number {
  const gamma = clamp01(gammaInput);
  const a = clamp01(aInput);
  const localC = clamp01(1 + getEffectiveStrictEps() - gamma);
  return gAtLocalC(localC, a);
}

export function composeGammas(gammas: number[], startInput: number): number {
  let current = clamp01(startInput);

  for (const gamma of gammas) {
    current = gAtGamma(gamma, current);
  }

  return current;
}

export function composeLocalCs(localCs: number[], startInput: number): number {
  let current = clamp01(startInput);

  for (const localC of localCs) {
    current = gAtLocalC(localC, current);
  }

  return current;
}

export function composeTwoLocalCs(
  firstLocalCInput: number,
  secondLocalCInput: number,
  startInput: number,
): number {
  const start = clamp01(startInput);
  const secondValue = gAtLocalC(secondLocalCInput, start);
  return gAtLocalC(firstLocalCInput, secondValue);
}

export interface ComposePairExperimentResult {
  passes: boolean;
  witnessT: number;
  minGap: number;
}

export function experimentallyCheckComposePairDominatesIdentity(
  firstLocalCInput: number,
  secondLocalCInput: number,
  sampleCount = 512,
): ComposePairExperimentResult {
  const firstLocalC = clamp01(firstLocalCInput);
  const secondLocalC = clamp01(secondLocalCInput);
  const steps = Math.max(1, Math.floor(sampleCount));
  const tolerance = 1e-6;
  let witnessT = 0;
  let minGap = Number.POSITIVE_INFINITY;
  let passes = true;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const value = composeTwoLocalCs(firstLocalC, secondLocalC, t);
    const gap = value - t;

    if (gap < minGap) {
      minGap = gap;
      witnessT = t;
    }

    if (gap < -tolerance) {
      passes = false;
    }
  }

  return {
    passes,
    witnessT,
    minGap,
  };
}

export function computeChainValuesForLocalCs(
  localCs: number[],
  startInput: number,
): number[] {
  const values = [clamp01(startInput)];
  let current = values[0];

  for (const localC of localCs) {
    current = gAtLocalC(localC, current);
    values.push(current);
  }

  return values;
}
