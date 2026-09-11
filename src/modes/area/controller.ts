import { setupAbUnionInteraction } from '../../ab-union/interaction';
import { renderAbUnionBoundaryControls } from '../../ab-union/render';
import {
  abUnionAValues,
  abUnionBValues,
  clearAbUnionFMarks,
  createDefaultAbUnionState,
  deleteSelectedAbUnionFMark,
  refreshAbUnionDeltaConstraints,
  setAbUnionLock,
  setAbUnionPreset,
  setAbUnionSumConstraint,
  setAbUnionTool,
} from '../../ab-union/state';
import type { AbUnionState } from '../../ab-union/types';
import {
  type AbUnionBoundaryRenderResult,
  type AbUnionPreset,
  type AbUnionSumConstraintMode,
  type AbUnionTool,
} from '../../ab-union/types';
import {
  areaConjToolText,
  clamp01,
  clampToLocalCMax,
  escapeHtml,
  formatAbUnionValues,
  formatAreaNumber,
  isAreaQuality,
  isAreaSumConstraintMode,
  isMaxAreaParam,
} from '../../app/format';
import {
  areaConjRequiredPoints,
  computeAreaConjResult,
  type AreaConjQuality,
  type AreaConjResult,
} from '../../areaConjecture';
import { config, mathToCanvas } from '../../coords';
import { drawHexagon } from '../../hexagon';
import { createRegionRenderer } from '../../region';
import type { Point, ShapeMode, TriangleState } from '../../types';

interface MaxAreaState {
  a: number;
  b: number;
  quality: AreaConjQuality;
  t3Like: boolean;
  result: AreaConjResult;
  dirty: boolean;
  sumConstraintMode: AbUnionSumConstraintMode;
}

interface Dependencies {
  readonly abUnionState: AbUnionState;
  readonly abUnionControls: HTMLDivElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly gammaValues: HTMLDivElement;
  readonly localCBounds: HTMLDivElement;
  readonly localCValues: HTMLDivElement;
  readonly ceStatus: HTMLDivElement;
  readonly ceChainStatus: HTMLDivElement;
  readonly coverOverlayStatus: HTMLDivElement;
  readonly regionRenderer: ReturnType<typeof createRegionRenderer>;
  readonly render: () => void;
  readonly shapeMode: ShapeMode;
  readonly canvas: HTMLCanvasElement;
  readonly triangleState: TriangleState;
  readonly manualLocalCs: number[];
}

export function createAreaController(deps: Dependencies) {
  let areaConjState = createDefaultAbUnionState();
  let areaConstraintDelta = 0.000001;
  const maxAreaState: MaxAreaState = {
    a: 0.2,
    b: 0.5,
    quality: 'coarse',
    t3Like: false,
    result: computeAreaConjResult(0, 0.2, 0.5, 'coarse'),
    dirty: false,
    sumConstraintMode: 'none',
  };
  let areaConjQuality: AreaConjQuality = 'coarse';
  let areaConjT3Like = Array<boolean>(6).fill(false);
  let areaConjResults: AreaConjResult[] = [];
  let areaConjDirty = true;
  const AREA_PARAM_STEP = '0.000001';
  const AREA_WHEEL_STEP = 0.001;
  const AREA_DELTA_STEP = '0.0001';
  const AREA_DELTA_MIN = 0.000001;
  const AREA_DELTA_MAX = 0.159999;
  const AREA_ONE_SUM_CONSTRAINT_TOLERANCE = 1e-12;
  const AREA_COLORS = ['#ef4444', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#14b8a6'];

  function clampAreaDelta(value: number): number {
    if (!Number.isFinite(value)) return areaConstraintDelta;
    return Math.max(AREA_DELTA_MIN, Math.min(AREA_DELTA_MAX, value));
  }

  function areaSumTarget(mode: AbUnionSumConstraintMode): number | null {
    if (mode === 'one') return 1 - AREA_ONE_SUM_CONSTRAINT_TOLERANCE;
    if (mode === 'one-plus-delta') return 1 + areaConstraintDelta;
    return null;
  }

  function areaSumModeText(mode: AbUnionSumConstraintMode): string {
    if (mode === 'current') return 'current';
    if (mode === 'one') return 'a+b=1';
    if (mode === 'one-plus-delta') return `a+b=${formatAreaNumber(1 + areaConstraintDelta)}`;
    return 'off';
  }

  function areaDeltaControlHtml(): string {
    return `
    <label>delta
      <input class="ab-hull-debug-number" type="number" min="${AREA_DELTA_MIN}" max="${AREA_DELTA_MAX}" step="${AREA_DELTA_STEP}" value="${formatAreaNumber(areaConstraintDelta)}" data-area-delta/>
    </label>
  `;
  }

  function setAreaConstraintDelta(rawValue: number): boolean {
    if (!Number.isFinite(rawValue)) return false;
    areaConstraintDelta = clampAreaDelta(rawValue);
    refreshAbUnionDeltaConstraints(deps.abUnionState, areaConstraintDelta);
    refreshAbUnionDeltaConstraints(areaConjState, areaConstraintDelta);
    if (maxAreaState.sumConstraintMode === 'one-plus-delta') {
      applyMaxAreaSumConstraint('a');
      recomputeMaxArea();
    }
    if (areaConjState.sumConstraintModes.includes('one-plus-delta')) {
      markAreaConjDirty();
      recomputeAreaConjResults();
    }
    return true;
  }

  function applyAreaDeltaInput(target: HTMLInputElement): boolean {
    if (target.dataset.areaDelta === undefined) return false;
    const updated = setAreaConstraintDelta(Number(target.value));
    target.value = formatAreaNumber(areaConstraintDelta);
    return updated;
  }

  function clampAreaPartForTarget(value: number, target: number): number {
    return Math.max(Math.max(0, target - 1), Math.min(Math.min(1, target), value));
  }

  function applyMaxAreaSumConstraint(preserve: 'a' | 'b'): void {
    const target = areaSumTarget(maxAreaState.sumConstraintMode);
    if (target === null) return;
    const preserved = clampAreaPartForTarget(maxAreaState[preserve], target);
    maxAreaState[preserve] = preserved;
    maxAreaState[preserve === 'a' ? 'b' : 'a'] = clamp01(target - preserved);
    maxAreaState.dirty = true;
  }

  function applyMaxAreaParameterInput(target: HTMLInputElement, commit: boolean): boolean {
    const param = target.dataset.maxAreaParam;
    if (!isMaxAreaParam(param)) return false;
    setMaxAreaParameter(param, Number(target.value), commit);
    return true;
  }

  function setMaxAreaParameter(key: 'a' | 'b', rawValue: number, commit: boolean): void {
    if (!Number.isFinite(rawValue)) return;
    const target = areaSumTarget(maxAreaState.sumConstraintMode);
    if (target === null) {
      maxAreaState[key] = clamp01(rawValue);
    } else {
      const value = clampAreaPartForTarget(rawValue, target);
      maxAreaState[key] = value;
      maxAreaState[key === 'a' ? 'b' : 'a'] = clamp01(target - value);
    }
    maxAreaState.dirty = true;
    if (commit) {
      recomputeMaxArea();
    }
  }

  function setMaxAreaSumConstraint(mode: AbUnionSumConstraintMode): void {
    maxAreaState.sumConstraintMode = mode === 'current' ? 'none' : mode;
    applyMaxAreaSumConstraint('a');
    recomputeMaxArea();
  }

  function recomputeMaxArea(): void {
    maxAreaState.result = computeAreaConjResult(0, maxAreaState.a, maxAreaState.b, maxAreaState.quality, maxAreaState.t3Like);
    maxAreaState.dirty = false;
  }

  function markAreaConjDirty(): void {
    areaConjDirty = true;
  }

  function recomputeAreaConjResults(): void {
    const aValues = abUnionAValues(areaConjState);
    const bValues = abUnionBValues(areaConjState);
    areaConjResults = Array.from({ length: 6 }, (_, index) =>
      computeAreaConjResult(index, aValues[index], bValues[index], areaConjQuality, areaConjT3Like[index] ?? false),
    );
    areaConjDirty = false;
  }

  function ensureAreaConjResults(): void {
    if (areaConjResults.length !== 6) {
      recomputeAreaConjResults();
    }
  }

  function drawAreaPolygon(
    ctx2d: CanvasRenderingContext2D,
    points: Point[],
    stroke: string,
    fill: string,
    lineWidth = 2,
  ): void {
    if (points.length === 0) return;
    const canvasPoints = points.map(mathToCanvas);
    ctx2d.beginPath();
    ctx2d.moveTo(canvasPoints[0].x, canvasPoints[0].y);
    for (const point of canvasPoints.slice(1)) {
      ctx2d.lineTo(point.x, point.y);
    }
    ctx2d.closePath();
    ctx2d.fillStyle = fill;
    ctx2d.strokeStyle = stroke;
    ctx2d.lineWidth = lineWidth;
    ctx2d.fill();
    ctx2d.stroke();
  }

  function drawAreaMarker(ctx2d: CanvasRenderingContext2D, point: Point, label: string, color: string): void {
    const canvasPoint = mathToCanvas(point);
    ctx2d.beginPath();
    ctx2d.arc(canvasPoint.x, canvasPoint.y, 4.7, 0, 2 * Math.PI);
    ctx2d.fillStyle = '#ffffff';
    ctx2d.fill();
    ctx2d.strokeStyle = color;
    ctx2d.lineWidth = 1.8;
    ctx2d.stroke();
    ctx2d.fillStyle = color;
    ctx2d.font = '12px monospace';
    ctx2d.fillText(label, canvasPoint.x + 6, canvasPoint.y - 6);
  }

  function drawAreaConjResult(ctx2d: CanvasRenderingContext2D, result: AreaConjResult, color: string): void {
    if (!result.triangle) return;
    drawAreaPolygon(ctx2d, result.triangle.vertices, color, `${color}16`, 1.8);
    drawAreaPolygon(ctx2d, result.triangle.intersection, color, `${color}24`, 1.2);
    const center = mathToCanvas(result.triangle.center);
    ctx2d.fillStyle = color;
    ctx2d.font = '12px monospace';
    ctx2d.fillText(`f${result.index}`, center.x + 5, center.y - 5);
  }

  function drawMaxAreaMode(ctx2d: CanvasRenderingContext2D): void {
    drawHexagon(ctx2d);
    const required = areaConjRequiredPoints(0, maxAreaState.a, maxAreaState.b);
    if (!maxAreaState.dirty) {
      drawAreaConjResult(ctx2d, maxAreaState.result, '#0ea5e9');
    }
    drawAreaMarker(ctx2d, required.vertex, 'V0', '#0f172a');
    drawAreaMarker(ctx2d, required.aPoint, 'a', '#d97706');
    drawAreaMarker(ctx2d, required.bPoint, 'b', '#2563eb');
  }

  function syncMaxAreaParameterControls(): void {
    const values = {
      a: formatAreaNumber(maxAreaState.a),
      b: formatAreaNumber(maxAreaState.b),
    };
    for (const key of ['a', 'b'] as const) {
      deps.abUnionControls
        .querySelectorAll<HTMLInputElement>(`input[data-max-area-param="${key}"]`)
        .forEach((input) => {
          input.value = values[key];
        });
    }
    const recompute = deps.abUnionControls.querySelector<HTMLButtonElement>('[data-max-area-recompute]');
    if (recompute) {
      recompute.disabled = !maxAreaState.dirty;
    }
  }

  function renderMaxAreaCanvasAndReadouts(): void {
    deps.ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawMaxAreaMode(deps.ctx);

    deps.gammaValues.textContent = `max area: a=${formatAreaNumber(maxAreaState.a)}, b=${formatAreaNumber(maxAreaState.b)}, a+b=${formatAreaNumber(maxAreaState.a + maxAreaState.b)}`;
    deps.localCBounds.textContent = `f(a,b)=${formatAreaNumber(maxAreaState.result.f)}, 1-f=${formatAreaNumber(maxAreaState.result.deficit)}`;
    deps.localCValues.textContent = maxAreaState.dirty
      ? 'stale: recompute after commit'
      : `quality=${maxAreaState.quality}, constraint=${areaSumModeText(maxAreaState.sumConstraintMode)}, T3-like=${maxAreaState.t3Like ? 'on' : 'off'}, evaluations=${maxAreaState.result.evaluations}`;
    deps.ceStatus.textContent = 'Max Area: CE/g-chain inactive';
    deps.ceStatus.style.color = '#475569';
    deps.ceChainStatus.textContent = maxAreaState.result.feasible ? 'realizing triangle found' : 'infeasible; using f=0';
    deps.ceChainStatus.style.color = maxAreaState.result.feasible ? '#047857' : '#b91c1c';
    deps.coverOverlayStatus.textContent = 'Max Area owns triangle overlay';
    deps.coverOverlayStatus.style.color = '#64748b';
  }

  function renderMaxAreaPanel(): void {
    const result = maxAreaState.result;
    const status = maxAreaState.dirty
      ? 'stale: release slider or press Enter to recompute'
      : result.feasible ? 'ready' : 'infeasible; using f=0';
    const statusClass = maxAreaState.dirty ? 'ab-union-pill is-warn' : result.feasible ? 'ab-union-pill is-good' : 'ab-union-pill empty';
    const triangleText = result.triangle
      ? `center=(${result.triangle.center.x.toFixed(4)}, ${result.triangle.center.y.toFixed(4)}), theta=${(result.triangle.phi * 180 / Math.PI).toFixed(2)} deg`
      : 'none';
    const constraintText = areaSumModeText(maxAreaState.sumConstraintMode);

    deps.abUnionControls.innerHTML = `
    <div class="ab-union-toolbar">
      <label>a
        <input type="range" min="0" max="1" step="${AREA_PARAM_STEP}" value="${formatAreaNumber(maxAreaState.a)}" data-max-area-param="a"/>
      </label>
      <input class="ab-hull-debug-number" type="number" min="0" max="1" step="${AREA_PARAM_STEP}" value="${formatAreaNumber(maxAreaState.a)}" data-max-area-param="a"/>
      <label>b
        <input type="range" min="0" max="1" step="${AREA_PARAM_STEP}" value="${formatAreaNumber(maxAreaState.b)}" data-max-area-param="b"/>
      </label>
      <input class="ab-hull-debug-number" type="number" min="0" max="1" step="${AREA_PARAM_STEP}" value="${formatAreaNumber(maxAreaState.b)}" data-max-area-param="b"/>
      <label>quality
        <select data-max-area-quality>
          <option value="coarse"${maxAreaState.quality === 'coarse' ? ' selected' : ''}>coarse</option>
          <option value="high"${maxAreaState.quality === 'high' ? ' selected' : ''}>high</option>
        </select>
      </label>
      <label><input type="checkbox" data-max-area-t3-like${maxAreaState.t3Like ? ' checked' : ''}/>T3-like</label>
      <button type="button" class="free-button" data-max-area-recompute${maxAreaState.dirty ? '' : ' disabled'}>recompute</button>
    </div>
    <div class="ab-union-toolbar">
      <span>sum constraint</span>
      <label><input type="checkbox" data-max-area-sum-mode="one"${maxAreaState.sumConstraintMode === 'one' ? ' checked' : ''}/>a+b=1</label>
      <label><input type="checkbox" data-max-area-sum-mode="one-plus-delta"${maxAreaState.sumConstraintMode === 'one-plus-delta' ? ' checked' : ''}/>a+b=1+delta</label>
      ${areaDeltaControlHtml()}
    </div>
    <div class="ab-union-readout">
      <span>status</span><strong><span class="${statusClass} status-reserve">${escapeHtml(status)}</span></strong>
      <span>a</span><strong>${formatAreaNumber(maxAreaState.a)}</strong>
      <span>b</span><strong>${formatAreaNumber(maxAreaState.b)}</strong>
      <span>a+b</span><strong>${formatAreaNumber(maxAreaState.a + maxAreaState.b)}</strong>
      <span>constraint</span><strong>${escapeHtml(constraintText)}</strong>
      <span>T3-like</span><strong>${maxAreaState.t3Like ? 'on' : 'off'}</strong>
      <span>delta</span><strong>${formatAreaNumber(areaConstraintDelta)}</strong>
      <span>f(a,b)</span><strong>${formatAreaNumber(result.f)}</strong>
      <span>1-f(a,b)</span><strong>${formatAreaNumber(result.deficit)}</strong>
      <span>quality</span><strong>${escapeHtml(maxAreaState.quality)}</strong>
      <span>evaluations</span><strong>${result.evaluations}</strong>
      <span>realizer</span><strong>${escapeHtml(triangleText)}</strong>
    </div>
  `;
  }

  function areaConjFMarkText(result: AbUnionBoundaryRenderResult | null): string {
    if (!result || result.fMarkCount === 0) return 'none';
    if (result.fMarkDistance !== null) return `distance=${result.fMarkDistance.toFixed(5)}`;
    return `${result.fMarkCount} dot${result.fMarkCount === 1 ? '' : 's'}`;
  }

  function renderAreaConjPanel(boundary: AbUnionBoundaryRenderResult): void {
    ensureAreaConjResults();
    const toolControls = (['move', 'add', 'delete', 'd-mark', 's-mark', 'f-mark'] as AbUnionTool[]).map((tool) => {
      const disabled = tool === 'd-mark' || tool === 's-mark';
      return `
      <button type="button" class="free-button${areaConjState.tool === tool ? ' is-active' : ''}" data-area-tool="${tool}"${disabled ? ' disabled' : ''}>${areaConjToolText(tool)}</button>
    `;
    }).join('');
    const totalF = areaConjResults.reduce((sum, result) => sum + result.f, 0);
    const totalDeficit = areaConjResults.reduce((sum, result) => sum + result.deficit, 0);
    const infeasibleCount = areaConjResults.filter((result) => !result.feasible).length;
    const gtOneCount = boundary.regionRows.filter((row) => row.sum > 1 + 1e-9).length;
    const t3LikeCount = areaConjT3Like.filter(Boolean).length;
    const staleText = areaConjDirty ? 'stale: current dots changed; f rows update after commit' : 'ready';
    const staleClass = areaConjDirty ? 'ab-union-pill is-warn' : 'ab-union-pill is-good';
    const regionRowsHtml = boundary.regionRows.map((row) => {
      const result = areaConjResults[row.index];
      const feasibleClass = result?.feasible ? 'active' : 'empty';
      const currentTitle = row.sumConstraintMode === 'current' && row.fixedSum !== null
        ? `fix current a${row.index}+b${row.index} = ${row.fixedSum.toFixed(4)}`
        : `fix current a${row.index}+b${row.index}`;
      return `
      <tr class="${areaConjState.activeRegions[row.index] ? 'ab-union-active-row' : ''}${row.sum > 1 + 1e-9 ? ' ab-union-equality-row' : ''}">
        <td>R${row.index}</td>
        <td><input type="checkbox" title="constrain f${row.index} to T3-like triangles" data-area-t3-index="${row.index}"${areaConjT3Like[row.index] ? ' checked' : ''}/></td>
        <td><input type="checkbox" title="include a${row.index} in the same-a group" data-area-lock-kind="a" data-area-lock-index="${row.index}"${row.aLocked ? ' checked' : ''}/></td>
        <td><input type="checkbox" title="include b${row.index} in the same-b group" data-area-lock-kind="b" data-area-lock-index="${row.index}"${row.bLocked ? ' checked' : ''}/></td>
        <td><input type="checkbox" title="${currentTitle}" data-area-sum-mode="current" data-area-sum-index="${row.index}"${row.sumConstraintMode === 'current' ? ' checked' : ''}/></td>
        <td><input type="checkbox" title="fix a${row.index}+b${row.index} = 1" data-area-sum-mode="one" data-area-sum-index="${row.index}"${row.sumConstraintMode === 'one' ? ' checked' : ''}/></td>
        <td><input type="checkbox" title="fix a${row.index}+b${row.index} = ${formatAreaNumber(1 + areaConstraintDelta)}" data-area-sum-mode="one-plus-delta" data-area-sum-index="${row.index}"${row.sumConstraintMode === 'one-plus-delta' ? ' checked' : ''}/></td>
        <td>${row.a.toFixed(4)}</td>
        <td>${row.b.toFixed(4)}</td>
        <td>${row.sum.toFixed(4)}</td>
        <td>${result ? result.f.toFixed(6) : '0.000000'}</td>
        <td>${result ? result.deficit.toFixed(6) : '1.000000'}</td>
        <td><span class="ab-union-pill ${feasibleClass}">${result?.feasible ? 'ok' : 'f=0'}</span></td>
      </tr>
    `;
    }).join('');
    const edgeRowsHtml = boundary.edgeRows.map((row) => `
    <tr>
      <td>e${row.index}</td>
      <td>${row.split ? 'two' : 'one'}</td>
      <td>${row.left.toFixed(4)}</td>
      <td>${row.right.toFixed(4)}</td>
    </tr>
  `).join('');

    deps.abUnionControls.innerHTML = `
    <div class="ab-union-toolbar">
      <span>tool</span>
      ${toolControls}
    </div>
    <div class="ab-union-toolbar">
      <span>f marks</span>
      <button type="button" class="free-button" data-area-fmark-delete${areaConjState.selectedFMarkId ? '' : ' disabled'}>delete selected</button>
      <button type="button" class="free-button" data-area-fmark-clear${boundary.fMarkCount > 0 ? '' : ' disabled'}>clear</button>
      <span class="free-small-status">${escapeHtml(areaConjFMarkText(boundary))}</span>
    </div>
    <div class="ab-union-toolbar">
      <label>quality
        <select data-area-quality>
          <option value="coarse"${areaConjQuality === 'coarse' ? ' selected' : ''}>coarse</option>
          <option value="high"${areaConjQuality === 'high' ? ' selected' : ''}>high</option>
        </select>
      </label>
      <button type="button" class="free-button" data-area-recompute${areaConjDirty ? '' : ' disabled'}>recompute f</button>
      <button type="button" class="free-button" data-area-preset="equality">equality</button>
      <button type="button" class="free-button" data-area-preset="midpoint">midpoints</button>
      ${areaDeltaControlHtml()}
    </div>
    <div class="ab-union-readout">
      <span>status</span><strong><span class="${staleClass} status-reserve">${escapeHtml(staleText)}</span></strong>
      <span>Σ f_i</span><strong>${totalF.toFixed(6)}</strong>
      <span>Σ (1-f_i)</span><strong>${totalDeficit.toFixed(6)}</strong>
      <span>rows with a_i+b_i &gt; 1</span><strong>${gtOneCount}</strong>
      <span>T3-like rows</span><strong>${t3LikeCount}</strong>
      <span>infeasible rows</span><strong>${infeasibleCount}</strong>
      <span>active boundaries</span><strong>${escapeHtml(boundary.activeLabel)}</strong>
      <span>quality</span><strong>${escapeHtml(areaConjQuality)}</strong>
      <span>delta</span><strong>${formatAreaNumber(areaConstraintDelta)}</strong>
      <span>f marks</span><strong>${escapeHtml(areaConjFMarkText(boundary))}</strong>
    </div>
    <div class="free-row"><span class="status-reserve">${escapeHtml(areaConjState.status)}</span></div>
    <div class="ab-union-section-title">region data</div>
    <table class="ab-union-table">
      <thead><tr><th>R_i</th><th>T3</th><th>same a</th><th>same b</th><th>fix current</th><th>=1</th><th>=1+delta</th><th>a_i</th><th>b_i</th><th>a_i+b_i</th><th>f_i</th><th>1-f_i</th><th>state</th></tr></thead>
      <tbody>${regionRowsHtml}</tbody>
    </table>
    <div class="ab-union-section-title">edge dots</div>
    <table class="ab-union-table">
      <thead><tr><th>edge</th><th>dots</th><th>left</th><th>right</th></tr></thead>
      <tbody>${edgeRowsHtml}</tbody>
    </table>
  `;
  }

  function renderMaxAreaFrame(): void {
    renderMaxAreaCanvasAndReadouts();
    deps.regionRenderer.render();
    renderMaxAreaPanel();
    return;
  }

  function renderAreaConjFrame(): void {
    ensureAreaConjResults();
    if (areaConjState.tool === 'd-mark' || areaConjState.tool === 's-mark') {
      setAbUnionTool(areaConjState, 'move');
    }
    deps.ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawHexagon(deps.ctx);
    if (!areaConjDirty) {
      for (const result of areaConjResults) {
        drawAreaConjResult(deps.ctx, result, AREA_COLORS[result.index] ?? '#0f172a');
      }
    }
    const boundary = renderAbUnionBoundaryControls(deps.ctx, areaConjState, { showFMarkTriangle: false });
    const totalF = areaConjResults.reduce((sum, result) => sum + result.f, 0);
    const totalDeficit = areaConjResults.reduce((sum, result) => sum + result.deficit, 0);
    deps.gammaValues.textContent = `${formatAbUnionValues('a', abUnionAValues(areaConjState))}; ${formatAbUnionValues('b', abUnionBValues(areaConjState))}`;
    deps.localCBounds.textContent = `Σf=${totalF.toFixed(6)}, Σ(1-f)=${totalDeficit.toFixed(6)}, quality=${areaConjQuality}`;
    deps.localCValues.textContent = areaConjDirty
      ? 'stale: f rows update after commit'
      : `rows with a_i+b_i>1: ${boundary.regionRows.filter((row) => row.sum > 1 + 1e-9).length}`;
    deps.ceStatus.textContent = 'Area Conj: CE/g-chain inactive';
    deps.ceStatus.style.color = '#475569';
    deps.ceChainStatus.textContent = areaConjDirty ? 'area values stale during edit' : 'area values current';
    deps.ceChainStatus.style.color = areaConjDirty ? '#c2410c' : '#047857';
    deps.coverOverlayStatus.textContent = 'Area Conj overlays: maximizing f_i triangles';
    deps.coverOverlayStatus.style.color = '#475569';
    deps.regionRenderer.render();
    renderAreaConjPanel(boundary);
    return;
  }

  function bindAreaControls(): void {
    deps.abUnionControls.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const areaTool = target.dataset.areaTool;
      if (areaTool === 'move' || areaTool === 'add' || areaTool === 'delete' || areaTool === 'f-mark') {
        setAbUnionTool(areaConjState, areaTool);
        deps.render();
        return;
      }
      if (target.dataset.areaFmarkDelete !== undefined) {
        deleteSelectedAbUnionFMark(areaConjState);
        deps.render();
        return;
      }
      if (target.dataset.areaFmarkClear !== undefined) {
        clearAbUnionFMarks(areaConjState);
        deps.render();
        return;
      }
      if (target.dataset.areaRecompute !== undefined) {
        recomputeAreaConjResults();
        deps.render();
        return;
      }
      const areaPreset = target.dataset.areaPreset as AbUnionPreset | undefined;
      if (areaPreset) {
        setAbUnionPreset(areaConjState, areaPreset);
        markAreaConjDirty();
        recomputeAreaConjResults();
        deps.render();
        return;
      }
      if (target.dataset.maxAreaRecompute !== undefined) {
        recomputeMaxArea();
        deps.render();
        return;
      }
    });

    deps.abUnionControls.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.maxAreaParam !== undefined) {
        if (target.type === 'number') return;
        applyMaxAreaParameterInput(target, false);
        syncMaxAreaParameterControls();
        renderMaxAreaCanvasAndReadouts();
        return;
      }
    });

    deps.abUnionControls.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return; const target = event.target; if (!(target instanceof HTMLInputElement)) return;
      if (applyAreaDeltaInput(target)) {
        deps.render();
        event.preventDefault();
        return;
      }
      if (applyMaxAreaParameterInput(target, true)) {
        deps.render();
        event.preventDefault();
        return;
      }
    });

    deps.abUnionControls.addEventListener('wheel', (event) => {
      const target = event.target; if (!(target instanceof HTMLInputElement)) return;
      if (deps.shapeMode === 'max-area') {
        const param = target.dataset.maxAreaParam;
        if (!isMaxAreaParam(param) || event.deltaY === 0) return;
        const direction = event.deltaY < 0 ? 1 : -1;
        setMaxAreaParameter(param, maxAreaState[param] + direction * AREA_WHEEL_STEP, true);
        deps.render();
        event.preventDefault();
        return;
      }
    });

    deps.abUnionControls.addEventListener('change', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && applyAreaDeltaInput(target)) {
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && applyMaxAreaParameterInput(target, true)) {
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.maxAreaSumMode !== undefined) {
        const mode = target.checked ? target.dataset.maxAreaSumMode : 'none';
        if (isAreaSumConstraintMode(mode)) {
          setMaxAreaSumConstraint(mode);
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.maxAreaT3Like !== undefined) {
        maxAreaState.t3Like = target.checked;
        recomputeMaxArea();
        deps.render();
        return;
      }
      if (target instanceof HTMLSelectElement && target.dataset.maxAreaQuality !== undefined) {
        if (isAreaQuality(target.value)) {
          maxAreaState.quality = target.value;
          recomputeMaxArea();
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLSelectElement && target.dataset.areaQuality !== undefined) {
        if (isAreaQuality(target.value)) {
          areaConjQuality = target.value;
          markAreaConjDirty();
          recomputeAreaConjResults();
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.areaT3Index !== undefined) {
        const index = Number(target.dataset.areaT3Index);
        if (Number.isInteger(index) && index >= 0 && index < 6) {
          areaConjT3Like[index] = target.checked;
          markAreaConjDirty();
          recomputeAreaConjResults();
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.areaSumMode !== undefined) {
        const index = Number(target.dataset.areaSumIndex);
        const mode = target.checked ? target.dataset.areaSumMode : 'none';
        if (Number.isInteger(index) && index >= 0 && index < 6) {
          if (isAreaSumConstraintMode(mode)) {
            setAbUnionSumConstraint(areaConjState, index, mode, areaConstraintDelta);
          }
          markAreaConjDirty();
          recomputeAreaConjResults();
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.areaLockKind !== undefined) {
        const index = Number(target.dataset.areaLockIndex);
        const kind = target.dataset.areaLockKind;
        if (Number.isInteger(index) && index >= 0 && index < 6) {
          if (kind === 'a' || kind === 'b') {
            setAbUnionLock(areaConjState, kind, index, target.checked);
          }
          markAreaConjDirty();
          recomputeAreaConjResults();
          deps.render();
        }
        return;
      }
    });

    setupAbUnionInteraction(
      deps.canvas,
      () => deps.shapeMode === 'area-conj',
      () => areaConjState,
      deps.triangleState,
      () => deps.manualLocalCs,
      (index, value) => {
        deps.manualLocalCs[index] = clampToLocalCMax(value, 1);
      },
      deps.render,
      {
        onPreviewChange: markAreaConjDirty,
        onCommitChange: recomputeAreaConjResults,
      },
    );
  }

  return {
    get areaConstraintDelta() { return areaConstraintDelta; },
    areaDeltaControlHtml,
    renderMaxAreaFrame,
    renderAreaConjFrame,
    bindAreaControls
  };
}
