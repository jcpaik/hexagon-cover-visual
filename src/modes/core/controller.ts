import { setupAbUnionInteraction } from '../../ab-union/interaction';
import { setAbUnionTool } from '../../ab-union/state';
import { isCoreGraphSampleRate, sanitizeCoreCasePointIds } from '../../app/controllerSnapshot';
import {
  clamp01,
  clampToLocalCMax,
  coreCaseToolText,
  countWord,
  escapeHtml,
  formatAbUnionValues,
  formatTuple,
} from '../../app/format';
import type { CoreCaseTool } from '../../app/types';
import { canvasToMath, config, scaleToMath } from '../../coords';
import {
  CORE_CASE_POINT_IDS,
  createDefaultCoreCaseState,
  drawCoreCaseGraphSample,
  isCoreCasePointId,
  moveCoreCaseDot,
  renderCoreCase,
  type CoreCaseOptions,
  type CoreCaseRenderResult,
} from '../../coreCase';
import { createCoreGraphRenderer } from '../../coreGraph';
import { drawHexagon, HEXAGON_VERTICES } from '../../hexagon';
import { createRegionRenderer } from '../../region';
import type { Point, ShapeMode, TriangleState } from '../../types';

interface Dependencies {
  readonly canvas: HTMLCanvasElement;
  readonly shapeMode: ShapeMode;
  readonly render: () => void;
  readonly abUnionControls: HTMLDivElement;
  manualLocalCs: number[];
  readonly ctx: CanvasRenderingContext2D;
  readonly triangleState: TriangleState;
  readonly gammaValues: HTMLDivElement;
  readonly localCBounds: HTMLDivElement;
  readonly localCValues: HTMLDivElement;
  readonly ceStatus: HTMLDivElement;
  readonly ceChainStatus: HTMLDivElement;
  readonly coverOverlayStatus: HTMLDivElement;
  readonly regionRenderer: ReturnType<typeof createRegionRenderer>;
}

export function createCoreController(deps: Dependencies) {
  const coreGraphStatus = document.getElementById('core-graph-status') as HTMLDivElement;
  const corePointControls = document.getElementById('core-point-controls') as HTMLDivElement;
  const coreSampleRateSelect = document.getElementById('core-sample-rate-select') as HTMLSelectElement;
  const coreDenseSpecialCurveToggle = document.getElementById('core-dense-special-curve-toggle') as HTMLInputElement;
  const coreSpecialNeighborhoodToggle = document.getElementById('core-special-neighborhood-toggle') as HTMLInputElement;
  const coreStrictTwoLineToggle = document.getElementById('core-strict-two-line-toggle') as HTMLInputElement;
  const coreRelaxedPToggle = document.getElementById('core-relaxed-p-toggle') as HTMLInputElement;
  const coreSurfaceCanvas = document.getElementById('core-surface-canvas') as HTMLCanvasElement;
  const coreHeatmapCanvas = document.getElementById('core-heatmap-canvas') as HTMLCanvasElement;
  const coreSliceSlider = document.getElementById('core-slice-slider') as HTMLInputElement;
  const coreSliceValueLabel = document.getElementById('core-slice-value') as HTMLSpanElement;
  const coreGraphRenderer = createCoreGraphRenderer(coreSurfaceCanvas, coreHeatmapCanvas);
  let coreCaseState = createDefaultCoreCaseState();
  let coreCaseOptions: CoreCaseOptions = {
    forceSum3: true,
    forceSum5: true,
    hardLimitDrag: false,
    algorithm2Diagonals: false,
    strictTwoLineSuperset: false,
    relaxedPPoints: false,
  };
  let coreCaseTool: CoreCaseTool = 'move';
  let coreCaseDisabledPointIds: string[] = [];
  let coreCaseIntervalPointFractions: number[] = Array(6).fill(0.5);

  function coreGraphDisabledPointIds(): string[] {
    const enabledIds = new Set(coreGraphRenderer.getEnabledPointIds());
    return CORE_CASE_POINT_IDS.filter((id) => !enabledIds.has(id));
  }

  function pruneCoreCaseDisabledPointIds(currentPointIds: readonly string[]): void {
    const currentIds = new Set(currentPointIds);
    coreCaseDisabledPointIds = coreCaseDisabledPointIds.filter((id) => currentIds.has(id));
  }

  function setCoreCasePointEnabled(pointId: string, enabled: boolean): void {
    if (!isCoreCasePointId(pointId)) {
      return;
    }

    const ids = new Set(coreCaseDisabledPointIds);
    if (enabled) {
      ids.delete(pointId);
    } else {
      ids.add(pointId);
    }
    coreCaseDisabledPointIds = sanitizeCoreCasePointIds(Array.from(ids));
  }

  function setCoreCaseRelaxedPPoints(enabled: boolean): void {
    coreCaseOptions.relaxedPPoints = enabled;
    if (enabled) {
      coreCaseOptions.forceSum3 = false;
      coreCaseOptions.forceSum5 = false;
    }
  }

  function setCoreCaseForceSum(index: 3 | 5, enabled: boolean): void {
    if (index === 3) {
      coreCaseOptions.forceSum3 = enabled;
    } else {
      coreCaseOptions.forceSum5 = enabled;
    }
    if (enabled) {
      coreCaseOptions.relaxedPPoints = false;
    }
  }

  function coreCasePointerMath(event: PointerEvent): Point {
    const rect = deps.canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? config.canvasSize / rect.width : 1;
    const scaleY = rect.height > 0 ? config.canvasSize / rect.height : 1;
    return canvasToMath({
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    });
  }

  function coreCaseHitScale(pointerType: string): number {
    if (pointerType === 'touch') return 1.75;
    if (pointerType === 'pen') return 1.35;
    return 1;
  }

  function pointDistance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function pointDot(a: Point, b: Point): number {
    return a.x * b.x + a.y * b.y;
  }

  function coreCaseEdgeVector(index: number): Point {
    const start = HEXAGON_VERTICES[index];
    const end = HEXAGON_VERTICES[(index + 1) % 6];
    return { x: end.x - start.x, y: end.y - start.y };
  }

  function coreCasePointOnEdge(index: number, value: number): Point {
    const start = HEXAGON_VERTICES[index];
    const edge = coreCaseEdgeVector(index);
    const t = clamp01(value);
    return { x: start.x + t * edge.x, y: start.y + t * edge.y };
  }

  function coreCaseProjectEdgeValue(point: Point, index: number): number {
    const start = HEXAGON_VERTICES[index];
    const edge = coreCaseEdgeVector(index);
    const relative = { x: point.x - start.x, y: point.y - start.y };
    return clamp01(pointDot(relative, edge) / pointDot(edge, edge));
  }

  function coreCaseIntervalPoint(index: number): Point | null {
    const edge = coreCaseState.edgeDots[index];
    if (!edge?.split) return null;
    const fraction = clamp01(coreCaseIntervalPointFractions[index] ?? 0.5);
    return coreCasePointOnEdge(index, edge.left + fraction * (edge.right - edge.left));
  }

  function hitCoreCaseIntervalPoint(point: Point, pointerType: string): number | null {
    const maxDistance = scaleToMath(12 * coreCaseHitScale(pointerType));
    let bestIndex: number | null = null;
    let bestDistance = Infinity;

    for (let index = 0;index < 6;index++) {
      const candidate = coreCaseIntervalPoint(index);
      if (!candidate) continue;
      const candidateDistance = pointDistance(point, candidate);
      if (candidateDistance <= maxDistance && candidateDistance < bestDistance) {
        bestIndex = index;
        bestDistance = candidateDistance;
      }
    }

    return bestIndex;
  }

  function setCoreCaseIntervalPointFromPoint(index: number, point: Point): void {
    const edge = coreCaseState.edgeDots[index];
    if (!edge?.split) return;
    const value = coreCaseProjectEdgeValue(point, index);
    const width = edge.right - edge.left;
    coreCaseIntervalPointFractions[index] = width > 1e-12
      ? clamp01((value - edge.left) / width)
      : 0.5;
  }

  function setupCoreCaseIntervalPointInteraction(): void {
    let active: { pointerId: number; index: number; } | null = null;

    function enabled(): boolean {
      return deps.shapeMode === 'core-case' && coreCaseTool === 'core-point';
    }

    function stop(): void {
      if (active && deps.canvas.hasPointerCapture(active.pointerId)) {
        deps.canvas.releasePointerCapture(active.pointerId);
      }
      active = null;
    }

    deps.canvas.addEventListener('pointerdown', (event) => {
      if (!enabled() || !event.isPrimary) return;
      const pointerType = event.pointerType || 'mouse';
      const point = coreCasePointerMath(event);
      const index = hitCoreCaseIntervalPoint(point, pointerType);
      if (index === null) {
        deps.canvas.style.cursor = 'default';
        return;
      }

      active = { pointerId: event.pointerId, index };
      deps.canvas.setPointerCapture(event.pointerId);
      setCoreCaseIntervalPointFromPoint(index, point);
      coreCaseState.status = `Dragging I${index}.`;
      deps.render();
      event.preventDefault();
    });

    deps.canvas.addEventListener('pointermove', (event) => {
      if (active) {
        if (active.pointerId !== event.pointerId) return;
        if (!enabled()) {
          stop();
          return;
        }
        setCoreCaseIntervalPointFromPoint(active.index, coreCasePointerMath(event));
        deps.render();
        event.preventDefault();
        return;
      }

      if (!enabled()) return;
      const pointerType = event.pointerType || 'mouse';
      const point = coreCasePointerMath(event);
      deps.canvas.style.cursor = hitCoreCaseIntervalPoint(point, pointerType) === null ? 'default' : 'grab';
    });

    deps.canvas.addEventListener('pointerup', (event) => {
      if (!active || active.pointerId !== event.pointerId) return;
      const index = active.index;
      stop();
      coreCaseState.status = `Updated I${index}.`;
      deps.render();
      event.preventDefault();
    });

    deps.canvas.addEventListener('pointercancel', (event) => {
      if (!active || active.pointerId !== event.pointerId) return;
      stop();
      deps.canvas.style.cursor = 'default';
    });
  }

  function coreCaseConstraintSummary(): string {
    const r3 = coreCaseOptions.forceSum3 && !coreCaseOptions.relaxedPPoints ? 'a3+b3=1' : 'a3+b3<=1';
    const r5 = coreCaseOptions.forceSum5 && !coreCaseOptions.relaxedPPoints ? 'a5+b5=1' : 'a5+b5<=1';
    const model = coreCaseOptions.strictTwoLineSuperset ? 'two-line AB superset' : 'exact AB';
    const pModel = coreCaseOptions.relaxedPPoints ? 'relaxed P circles' : 'actual P circles';
    return `Core Case slice: ${r3}, ${r5}, a4+b4>1, a0+b0,a1+b1,a2+b2<=1; ${model}; ${pModel}`;
  }

  function syncCoreGraphPanel(): void {
    const range = coreGraphRenderer.getRange();
    const sliceK = coreGraphRenderer.getSliceK();
    const sample = coreGraphRenderer.getSelection();
    const enabledIds = new Set(coreGraphRenderer.getEnabledPointIds());
    coreSliceSlider.min = range.min.toString();
    coreSliceSlider.max = range.max.toString();
    coreSliceSlider.step = ((range.max - range.min) / 1000).toString();
    coreSliceSlider.value = sliceK.toString();
    coreSliceValueLabel.textContent = sliceK.toFixed(6);
    coreSampleRateSelect.value = coreGraphRenderer.getSampleRate();
    coreDenseSpecialCurveToggle.checked = coreGraphRenderer.getDenseSpecialCurveSampling();
    coreSpecialNeighborhoodToggle.checked = coreGraphRenderer.getSpecialCurveNeighborhoodOnly();
    coreStrictTwoLineToggle.checked = coreGraphRenderer.getStrictTwoLineSuperset();
    coreRelaxedPToggle.checked = coreGraphRenderer.getRelaxedPPoints();
    coreGraphStatus.textContent = sample.side === null
      ? `selected a=${sample.a.toFixed(4)}, b=${sample.b.toFixed(4)}: ${sample.status}`
      : `selected a=${sample.a.toFixed(4)}, b=${sample.b.toFixed(4)}, f=${sample.side.toFixed(6)} using ${sample.enabledPointCount} points`;
    corePointControls.innerHTML = `
    <span>points</span>
    ${CORE_CASE_POINT_IDS.map((id) => `
      <label>
        <input type="checkbox" data-core-graph-point="${escapeHtml(id)}"${enabledIds.has(id) ? ' checked' : ''}/>
        ${escapeHtml(id)}
      </label>
    `).join('')}
  `;
  }

  function renderCoreCasePanel(result: CoreCaseRenderResult): void {
    const boundaryToolControls = (['move', 'add', 'delete', 'core-point'] as CoreCaseTool[]).map((tool) => `
      <button type="button" class="free-button${coreCaseTool === tool ? ' is-active' : ''}" data-core-case-tool="${tool}">${coreCaseToolText(tool)}</button>
    `).join('');
    const boundaryToolbar = `
    <div class="ab-union-toolbar">
      <span>tool</span>
      ${boundaryToolControls}
    </div>
    <div class="free-row"><span class="status-reserve">${escapeHtml(coreCaseState.status)}</span></div>
  `;
    const hardLimitControls = `
    <div class="ab-union-toolbar">
      <span>drag</span>
      <label><input type="checkbox" data-core-case-hard-limit${coreCaseOptions.hardLimitDrag ? ' checked' : ''}/>hard limit</label>
    </div>
  `;
    const forceControls = `
    <div class="ab-union-toolbar">
      <span>force</span>
      <label><input type="checkbox" data-core-case-force-sum="3"${coreCaseOptions.forceSum3 && !coreCaseOptions.relaxedPPoints ? ' checked' : ''}/>a3+b3=1</label>
      <label><input type="checkbox" data-core-case-force-sum="5"${coreCaseOptions.forceSum5 && !coreCaseOptions.relaxedPPoints ? ' checked' : ''}/>a5+b5=1</label>
    </div>
  `;
    const pPointControls = `
    <div class="ab-union-toolbar">
      <span>P circles</span>
      <label><input type="checkbox" data-core-case-relaxed-p${coreCaseOptions.relaxedPPoints ? ' checked' : ''}/>relaxed P circles</label>
    </div>
  `;
    const dPointControls = `
    <div class="ab-union-toolbar">
      <span>D points</span>
      <label><input type="checkbox" data-core-case-algorithm2-diagonals${coreCaseOptions.algorithm2Diagonals ? ' checked' : ''}/>algorithm 2</label>
    </div>
  `;
    const regionControls = `
    <div class="ab-union-toolbar">
      <span>AB model</span>
      <label><input type="checkbox" data-core-case-strict-two-line${coreCaseOptions.strictTwoLineSuperset ? ' checked' : ''}/>two-line AB superset</label>
    </div>
  `;
    const optionControls = `${hardLimitControls}${forceControls}${pPointControls}${dPointControls}${regionControls}`;
    const rowHtml = result.rows.map((row) => `
    <tr>
      <td>R${row.index}</td>
      <td>${row.a.toFixed(4)}</td>
      <td>${row.b.toFixed(4)}</td>
      <td>${row.sum.toFixed(4)}</td>
      <td>${escapeHtml(row.constraint)}</td>
      <td><span class="ab-union-pill ${row.ok ? 'is-good' : 'is-warn'}">${row.ok ? 'ok' : 'check'}</span></td>
    </tr>
  `).join('');
    const pointHtml = result.points.map((item) => {
      const xText = !item.enabled ? 'off' : item.point ? item.point.x.toFixed(5) : 'missing';
      const yText = !item.enabled ? 'off' : item.point ? item.point.y.toFixed(5) : 'missing';
      return `
    <tr>
      <td><input type="checkbox" data-core-case-point="${escapeHtml(item.id)}"${item.enabled ? ' checked' : ''}/></td>
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.label)}</td>
      <td>${xText}</td>
      <td>${yText}</td>
    </tr>
  `;
    }).join('');
    const edgeRowsHtml = result.base.edgeRows.map((row) => `
    <tr>
      <td>e${row.index}</td>
      <td>${row.split ? 'two' : 'one'}</td>
      <td>${row.left.toFixed(4)}</td>
      <td>${row.right.toFixed(4)}</td>
    </tr>
  `).join('');
    const sideText = result.triangle
      ? result.triangle.side.toFixed(6)
      : result.enabledPointCount === 0 ? 'no points selected' : 'missing points';
    const sideClass = result.triangle && result.triangle.side <= 1
      ? 'ab-union-ok'
      : result.triangle ? 'ab-union-bad' : '';
    const pointCount = result.enabledPointCount;

    deps.abUnionControls.innerHTML = `
    ${boundaryToolbar}
    ${optionControls}
    <div class="ab-union-readout">
      <span>${pointCount}-point triangle side</span><strong class="${sideClass}">${escapeHtml(sideText)}</strong>
      <span>a4+b4-1</span><strong>${result.strictGap.toExponential(3)}</strong>
      <span>X values</span><strong>${escapeHtml(formatTuple(result.tValues))}</strong>
      <span>status</span><strong class="status-reserve">${escapeHtml(result.status)}</strong>
    </div>
    <div class="ab-union-section-title">Core Case constraints</div>
    <table class="ab-union-table">
      <thead><tr><th>R</th><th>a</th><th>b</th><th>a+b</th><th>constraint</th><th>state</th></tr></thead>
      <tbody>${rowHtml}</tbody>
    </table>
    <div class="ab-union-section-title">edge dots</div>
    <table class="ab-union-table">
      <thead><tr><th>edge</th><th>dots</th><th>left</th><th>right</th></tr></thead>
      <tbody>${edgeRowsHtml}</tbody>
    </table>
    <div class="ab-union-section-title">${countWord(pointCount)} selected points</div>
    <table class="ab-union-table">
      <thead><tr><th>use</th><th>id</th><th>source</th><th>x</th><th>y</th></tr></thead>
      <tbody>${pointHtml}</tbody>
    </table>
  `;
  }

  function renderCoreCaseFrame(): void {
    deps.manualLocalCs = deps.manualLocalCs.map((value) => clampToLocalCMax(value, 1));
    deps.ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawHexagon(deps.ctx);
    const result = renderCoreCase(
      deps.ctx,
      coreCaseState,
      deps.triangleState,
      deps.manualLocalCs,
      coreCaseOptions,
      {
        disabledPointIds: coreCaseDisabledPointIds,
        intervalPointFractions: coreCaseIntervalPointFractions,
      },
    );
    pruneCoreCaseDisabledPointIds(result.points.map((point) => point.id));
    deps.gammaValues.textContent = `${formatAbUnionValues('a', result.aValues)}; ${formatAbUnionValues('b', result.bValues)}`;
    deps.localCBounds.textContent = coreCaseConstraintSummary();
    deps.localCValues.textContent = result.triangle
      ? `${result.enabledPointCount}-point side = ${result.triangle.side.toFixed(6)}, uncovered samples = ${result.base.uncoveredCount}`
      : `Core Case side unavailable: ${result.status}`;
    deps.ceStatus.textContent = 'Core Case: CE/g-chain inactive';
    deps.ceStatus.style.color = '#475569';
    deps.ceChainStatus.textContent = `strict gap a4+b4-1 = ${result.strictGap.toExponential(3)}`;
    deps.ceChainStatus.style.color = result.strictGap > 0 ? '#047857' : '#b91c1c';
    deps.coverOverlayStatus.textContent = 'Core Case overlays: circles, selected points, enclosing triangle';
    deps.coverOverlayStatus.style.color = '#475569';
    deps.regionRenderer.render();
    renderCoreCasePanel(result);
    return;
  }

  function renderCoreGraphFrame(): void {
    const sample = coreGraphRenderer.getSelection();
    deps.ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    drawHexagon(deps.ctx);
    drawCoreCaseGraphSample(deps.ctx, sample);
    deps.gammaValues.textContent = `a4=${sample.a.toFixed(6)}, b4=${sample.b.toFixed(6)}, a4+b4-1=${sample.strictGap.toExponential(3)}`;
    deps.localCBounds.textContent = `Core graph domain: a+b>1 and a^2+ab+b^2<=1; D points use algorithm 2; ${coreGraphRenderer.getStrictTwoLineSuperset() ? 'two-line AB superset' : 'exact AB'}; ${coreGraphRenderer.getRelaxedPPoints() ? 'relaxed P circles' : 'actual P circles'}`;
    const enabledCoreGraphPoints = sample.points.filter((point) => point.enabled).map((point) => point.id).join(' ');
    deps.localCValues.textContent = sample.side === null
      ? `f(a,b) unavailable: ${sample.status}`
      : `f(a,b) = ${sample.side.toFixed(6)} from ${enabledCoreGraphPoints}`;
    deps.ceStatus.textContent = 'Core f(a,b): CE/g-chain inactive';
    deps.ceStatus.style.color = '#475569';
    deps.ceChainStatus.textContent = sample.domainStatus;
    deps.ceChainStatus.style.color = sample.domainOk ? '#047857' : '#b91c1c';
    deps.coverOverlayStatus.textContent = 'Core graph overlays: selected sample circles, points, enclosing triangle';
    deps.coverOverlayStatus.style.color = '#475569';
    syncCoreGraphPanel();
    coreGraphRenderer.render();
    return;
  }

  function bindCoreControls(): void {
    coreSliceSlider.addEventListener('input', () => {
      coreGraphRenderer.setSliceK(parseFloat(coreSliceSlider.value));
      coreSliceValueLabel.textContent = coreGraphRenderer.getSliceK().toFixed(6);
      deps.render();
    });

    coreSampleRateSelect.addEventListener('change', () => {
      const requested = coreSampleRateSelect.value;
      if (!isCoreGraphSampleRate(requested)) {
        return;
      }
      coreGraphRenderer.setSampleRate(requested);
      deps.render();
    });

    coreDenseSpecialCurveToggle.addEventListener('change', () => {
      coreGraphRenderer.setDenseSpecialCurveSampling(coreDenseSpecialCurveToggle.checked);
      deps.render();
    });

    coreSpecialNeighborhoodToggle.addEventListener('change', () => {
      coreGraphRenderer.setSpecialCurveNeighborhoodOnly(coreSpecialNeighborhoodToggle.checked);
      deps.render();
    });

    coreStrictTwoLineToggle.addEventListener('change', () => {
      coreGraphRenderer.setStrictTwoLineSuperset(coreStrictTwoLineToggle.checked);
      deps.render();
    });

    coreRelaxedPToggle.addEventListener('change', () => {
      coreGraphRenderer.setRelaxedPPoints(coreRelaxedPToggle.checked);
      deps.render();
    });

    corePointControls.addEventListener('change', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || target.dataset.coreGraphPoint === undefined) {
        return;
      }
      const requested = target.dataset.coreGraphPoint;
      if (!CORE_CASE_POINT_IDS.includes(requested)) {
        return;
      }
      const enabled = new Set(coreGraphRenderer.getEnabledPointIds());
      if (target.checked) {
        enabled.add(requested);
      } else {
        enabled.delete(requested);
      }
      coreGraphRenderer.setEnabledPointIds(CORE_CASE_POINT_IDS.filter((id) => enabled.has(id)));
      deps.render();
    });

    deps.abUnionControls.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const requestedCoreCaseTool = target.dataset.coreCaseTool;
      if (
        requestedCoreCaseTool === 'move' ||
        requestedCoreCaseTool === 'add' ||
        requestedCoreCaseTool === 'delete' ||
        requestedCoreCaseTool === 'core-point'
      ) {
        if (requestedCoreCaseTool === 'core-point') {
          coreCaseState.status = 'Core point mode: drag interval candidates.';
        } else {
          setAbUnionTool(coreCaseState, requestedCoreCaseTool);
        }
        coreCaseTool = requestedCoreCaseTool;
        deps.render();
        return;
      }
    });

    deps.abUnionControls.addEventListener('change', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && target.dataset.coreCaseHardLimit !== undefined) {
        coreCaseOptions.hardLimitDrag = target.checked;
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.coreCaseForceSum !== undefined) {
        if (target.dataset.coreCaseForceSum === '3') {
          setCoreCaseForceSum(3, target.checked);
          deps.render();
        } else if (target.dataset.coreCaseForceSum === '5') {
          setCoreCaseForceSum(5, target.checked);
          deps.render();
        }
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.coreCaseRelaxedP !== undefined) {
        setCoreCaseRelaxedPPoints(target.checked);
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.coreCaseAlgorithm2Diagonals !== undefined) {
        coreCaseOptions.algorithm2Diagonals = target.checked;
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.coreCaseStrictTwoLine !== undefined) {
        coreCaseOptions.strictTwoLineSuperset = target.checked;
        deps.render();
        return;
      }
      if (target instanceof HTMLInputElement && target.dataset.coreCasePoint !== undefined) {
        setCoreCasePointEnabled(target.dataset.coreCasePoint, target.checked);
        deps.render();
        return;
      }
    });

    setupAbUnionInteraction(
      deps.canvas,
      () => deps.shapeMode === 'core-case' && coreCaseTool !== 'core-point',
      () => coreCaseState,
      deps.triangleState,
      () => deps.manualLocalCs,
      (index, value) => {
        deps.manualLocalCs[index] = clampToLocalCMax(value, 1);
      },
      deps.render,
      {
        moveDotValue: (state, dot, value) => moveCoreCaseDot(state, dot, value, coreCaseOptions),
      },
    );

    setupCoreCaseIntervalPointInteraction();

    coreGraphRenderer.setOnSelectionChange(() => {
      deps.render();
    });
  }

  return {
    get coreGraphRenderer() { return coreGraphRenderer; },
    get coreCaseDisabledPointIds() { return coreCaseDisabledPointIds; },
    set coreCaseDisabledPointIds(value: string[]) { coreCaseDisabledPointIds = value; },
    get coreCaseIntervalPointFractions() { return coreCaseIntervalPointFractions; },
    set coreCaseIntervalPointFractions(value: number[]) { coreCaseIntervalPointFractions = value; },
    get coreCaseOptions() { return coreCaseOptions; },
    coreGraphDisabledPointIds,
    setCoreCaseRelaxedPPoints,
    get coreCaseTool() { return coreCaseTool; },
    set coreCaseTool(value: CoreCaseTool) { coreCaseTool = value; },
    get coreCaseState() { return coreCaseState; },
    renderCoreCaseFrame,
    renderCoreGraphFrame,
    bindCoreControls
  };
}
