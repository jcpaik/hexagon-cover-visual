const EPS = 1e-9;
const FALLBACK_SAMPLES = 384;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isNear(value: number, target: number): boolean {
  return Math.abs(value - target) <= EPS;
}

function circleArcBound(a: number): number {
  const disc = Math.max(0, 4 - 3 * a * a);
  return clamp01((-a + Math.sqrt(disc)) / 2);
}

function transitionSum(a: number): number {
  let lo = clamp01(a);
  let hi = 1;
  const evaluate = (s: number): number => (s ** 4) - (s * s) + a * s - a * a;

  if (evaluate(hi) <= 0) {
    return hi;
  }

  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (evaluate(mid) <= 0) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}

function lowCoverageRoot(localC: number): number | null {
  const disc = 4 * localC * localC - 3;
  if (disc < 0) {
    return null;
  }
  return clamp01((localC * (1 - Math.sqrt(disc))) / 2);
}

function cell2Coverage(a: number, localC: number): number | null {
  if (localC <= EPS) {
    return null;
  }
  if (isNear(localC, 1)) {
    return clamp01((1 - a * a) / (1 + 2 * a));
  }

  const disc = 4 * (a * a + a * localC + localC * localC) - 3;
  if (disc < 0) {
    return null;
  }

  const numerator = localC * (1 + 2 * a * localC - Math.sqrt(disc));
  const denominator = 2 * (1 - localC * localC);
  return denominator <= EPS ? null : clamp01(numerator / denominator);
}

function cell5Coverage(a: number, localC: number): number | null {
  if (localC <= EPS) {
    return null;
  }

  const disc = Math.max(0, a * a - a * localC + localC * localC);
  return clamp01((Math.sqrt(disc) - a * localC) / localC);
}

function cell6Coverage(a: number, localC: number): number | null {
  if (localC <= EPS) {
    return null;
  }

  const disc = Math.max(0, a * a - a * localC + localC * localC);
  return clamp01((Math.sqrt(disc) - a * a) / localC);
}

function cell3MaxA(b: number, localC: number): number {
  const disc = Math.max(0, b * b - b * localC + localC * localC);
  return clamp01((Math.sqrt(disc) - b * b) / localC);
}

function cell3Coverage(a: number, localC: number): number | null {
  if (localC <= EPS || localC > 0.5 + EPS) {
    return null;
  }

  const lo0 = Math.max(a, 1 - a);
  const hi0 = circleArcBound(a);
  if (hi0 < lo0 - EPS) {
    return null;
  }
  if (cell3MaxA(hi0, localC) >= a - EPS) {
    return hi0;
  }
  if (cell3MaxA(lo0, localC) < a - EPS) {
    return null;
  }

  let lo = lo0;
  let hi = hi0;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (cell3MaxA(mid, localC) >= a) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return (lo + hi) / 2;
}

function admissible(aInput: number, bInput: number, localCInput: number): boolean {
  const a = clamp01(aInput);
  const b = clamp01(bInput);
  const c = clamp01(localCInput);
  const sum = a + b;
  const circle = a * a + a * b + b * b;
  const transition = sum ** 4 - sum * sum + a * b;

  const cell1 =
    a <= b + EPS &&
    sum <= 1 + EPS &&
    circle <= 1 + EPS &&
    transition <= EPS &&
    c ** 4 - c * c + a * c - a * a <= EPS;

  const cell2 =
    a <= b + EPS &&
    sum <= 1 + EPS &&
    circle <= 1 + EPS &&
    transition >= -EPS &&
    ((sum * sum - 1) * c * c) + b * c - b * b <= EPS;

  const cell3 =
    a <= b + EPS &&
    sum >= 1 - EPS &&
    circle <= 1 + EPS &&
    ((a * a - 1) * c * c) + (2 * a * b * b + b) * c + (b ** 4 - b * b) <= EPS &&
    c <= 0.5 + EPS;

  const cell4 =
    b <= a + EPS &&
    sum <= 1 + EPS &&
    circle <= 1 + EPS &&
    transition <= EPS &&
    c ** 4 - c * c + b * c - b * b <= EPS;

  const cell5 =
    b <= a + EPS &&
    sum <= 1 + EPS &&
    circle <= 1 + EPS &&
    transition >= -EPS &&
    ((sum * sum - 1) * c * c) + a * c - a * a <= EPS;

  const cell6 =
    b <= a + EPS &&
    sum >= 1 - EPS &&
    circle <= 1 + EPS &&
    ((b * b - 1) * c * c) + (2 * b * a * a + a) * c + (a ** 4 - a * a) <= EPS &&
    c <= 0.5 + EPS;

  return cell1 || cell2 || cell3 || cell4 || cell5 || cell6;
}

function fallbackCoverage(a: number, localC: number, seed: number): number {
  const upper = circleArcBound(a);
  let best = admissible(a, seed, localC) ? clamp01(seed) : 0;
  const step = upper / FALLBACK_SAMPLES;

  for (let i = 0; i <= FALLBACK_SAMPLES; i++) {
    const b = step * i;
    if (b >= best && admissible(a, b, localC)) {
      best = b;
    }
  }

  let lo = best;
  let hi = Math.min(upper, best + step);
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (admissible(a, mid, localC)) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return lo;
}

export function maxAdmissibleCoverage(aInput: number, localCInput: number): number {
  const a = clamp01(aInput);
  const localC = clamp01(localCInput);

  if (localC <= EPS) {
    return circleArcBound(a);
  }

  const candidates: number[] = [0, a, 1 - a, circleArcBound(a), transitionSum(a) - a];

  const lowRoot = lowCoverageRoot(localC);
  if (lowRoot !== null) {
    candidates.push(lowRoot);
  }

  const branch2 = cell2Coverage(a, localC);
  if (branch2 !== null) {
    candidates.push(branch2);
  }

  const branch3 = cell3Coverage(a, localC);
  if (branch3 !== null) {
    candidates.push(branch3);
  }

  const branch5 = cell5Coverage(a, localC);
  if (branch5 !== null) {
    candidates.push(branch5);
  }

  const branch6 = cell6Coverage(a, localC);
  if (branch6 !== null) {
    candidates.push(branch6);
  }

  let best = 0;
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate)) {
      continue;
    }
    const clamped = clamp01(candidate);
    if (admissible(a, clamped, localC) && clamped > best) {
      best = clamped;
    }
  }

  if (best === 0 || localC >= 1 - EPS) {
    best = Math.max(best, fallbackCoverage(a, localC, best));
  }

  return clamp01(best);
}

export function gAtGamma(gammaInput: number, aInput: number): number {
  const gamma = clamp01(gammaInput);
  const a = clamp01(aInput);
  const localC = 1 - gamma;
  return clamp01(1 - maxAdmissibleCoverage(a, localC));
}

export function composeGammas(gammas: number[], startInput: number): number {
  let current = clamp01(startInput);

  for (const gamma of gammas) {
    current = gAtGamma(gamma, current);
  }

  return current;
}

export function computeChainValues(gammas: number[], startInput: number): number[] {
  const values = [clamp01(startInput)];
  let current = values[0];

  for (const gamma of gammas) {
    current = gAtGamma(gamma, current);
    values.push(current);
  }

  return values;
}
