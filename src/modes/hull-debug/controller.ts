import {
  clearAbHullDebugExports,
  clearAbHullDebugPolygon,
  closeAbHullDebugPolygon,
  createDefaultAbHullDebugState,
  deleteSelectedAbHullDebugVertex,
  exportAbHullDebugExperiment,
  formatAbHullDebugExports,
  loadSuggestedAbHullDebugPolygon,
  renderAbHullDebug,
  resetAbHullDebugExample,
  setAbHullDebugParameter,
  setupAbHullDebugInteraction,
  undoAbHullDebugVertex,
  type AbHullDebugResult,
} from '../../abHullDebug';
import { escapeHtml } from '../../app/format';
import { config } from '../../coords';
import { createRegionRenderer } from '../../region';
import type { ShapeMode } from '../../types';

interface Dependencies {
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
}

export function createHullDebugController(deps: Dependencies) {
  let abHullDebugState = createDefaultAbHullDebugState();
  let currentAbHullDebugResult: AbHullDebugResult | null = null;
  const AB_HULL_DEBUG_PARAM_STEP = '0.000001';
  const AB_HULL_DEBUG_WHEEL_STEP = 0.001;

  function isAbHullDebugParam(value: string | undefined): value is 'a' | 'b' {
    return value === 'a' || value === 'b';
  }

  function formatAbHullDebugParameter(value: number): string {
    return value.toFixed(6);
  }

  function applyAbHullDebugParameterInput(target: HTMLInputElement): boolean {
    const debugParam = target.dataset.hullDebugParam;
    if (!isAbHullDebugParam(debugParam)) return false;
    setAbHullDebugParameter(abHullDebugState, debugParam, Number(target.value));
    return true;
  }

  function syncAbHullDebugParameterControls(): void {
    const values = {
      a: formatAbHullDebugParameter(abHullDebugState.a),
      b: formatAbHullDebugParameter(abHullDebugState.b),
    };
    for (const key of ['a', 'b'] as const) {
      deps.abUnionControls
        .querySelectorAll<HTMLInputElement>(`input[data-hull-debug-param="${key}"]`)
        .forEach((input) => {
          input.value = values[key];
        });
    }
    const sum = deps.abUnionControls.querySelector<HTMLElement>('[data-hull-debug-sum]');
    if (sum) {
      sum.textContent = `a+b=${formatAbHullDebugParameter(abHullDebugState.a + abHullDebugState.b)}`;
    }
  }

  function renderAbHullDebugPanel(result: AbHullDebugResult): void {
    const coverageClass = result.closed && result.missedCount === 0
      ? 'ab-union-ok'
      : result.closed ? 'ab-union-bad' : '';
    const coverageText = result.closed
      ? result.missedCount === 0
        ? `contains all ${result.sampleCount} samples`
        : `misses ${result.missedCount} of ${result.sampleCount}`
      : `${result.sampleCount} exact samples; polygon open`;
    const exportCount = abHullDebugState.exports.length;
    const noSuggestedHull = abHullDebugState.a + abHullDebugState.b >= 1 - 1e-9;
    const aValue = formatAbHullDebugParameter(abHullDebugState.a);
    const bValue = formatAbHullDebugParameter(abHullDebugState.b);

    deps.abUnionControls.innerHTML = `
    <div class="ab-union-toolbar">
      <label>a
        <input type="range" min="0" max="1" step="${AB_HULL_DEBUG_PARAM_STEP}" value="${aValue}" data-hull-debug-param="a"/>
      </label>
      <input class="ab-hull-debug-number" type="number" min="0" max="1" step="${AB_HULL_DEBUG_PARAM_STEP}" value="${aValue}" data-hull-debug-param="a"/>
      <label>b
        <input type="range" min="0" max="1" step="${AB_HULL_DEBUG_PARAM_STEP}" value="${bValue}" data-hull-debug-param="b"/>
      </label>
      <input class="ab-hull-debug-number" type="number" min="0" max="1" step="${AB_HULL_DEBUG_PARAM_STEP}" value="${bValue}" data-hull-debug-param="b"/>
      <span class="free-small-status" data-hull-debug-sum>a+b=${formatAbHullDebugParameter(abHullDebugState.a + abHullDebugState.b)}</span>
    </div>
    <div class="ab-union-toolbar">
      <button type="button" class="free-button" data-hull-debug-close${abHullDebugState.vertices.length >= 3 && !abHullDebugState.closed ? '' : ' disabled'}>close polygon</button>
      <button type="button" class="free-button" data-hull-debug-undo${abHullDebugState.vertices.length > 0 ? '' : ' disabled'}>undo</button>
      <button type="button" class="free-button" data-hull-debug-delete${abHullDebugState.selectedIndex !== null && (!abHullDebugState.closed || abHullDebugState.vertices.length > 3) ? '' : ' disabled'}>delete selected dot</button>
      <button type="button" class="free-button" data-hull-debug-clear${abHullDebugState.vertices.length > 0 ? '' : ' disabled'}>clear</button>
      <button type="button" class="free-button" data-hull-debug-suggested${noSuggestedHull ? ' disabled' : ''}>load suggested hull</button>
      <button type="button" class="free-button" data-hull-debug-reset>reset example</button>
    </div>
    <div class="ab-union-toolbar">
      <button type="button" class="free-button" data-hull-debug-export${abHullDebugState.vertices.length > 0 ? '' : ' disabled'}>export current</button>
      <button type="button" class="free-button" data-hull-debug-copy-exports${exportCount > 0 ? '' : ' disabled'}>copy json</button>
      <button type="button" class="free-button" data-hull-debug-clear-exports${exportCount > 0 ? '' : ' disabled'}>clear exports</button>
      <span class="free-small-status">${exportCount} exported</span>
    </div>
    <div class="ab-union-readout">
      <span>coverage</span><strong class="${coverageClass}">${escapeHtml(coverageText)}</strong>
      <span>vertices</span><strong>${abHullDebugState.vertices.length}${abHullDebugState.closed ? ' closed' : ''}</strong>
      <span>edge directions</span><strong>u, v, u-v</strong>
      <span>status</span><strong class="status-reserve">${escapeHtml(abHullDebugState.status)}</strong>
    </div>
    <div class="ab-union-section-title">current polygon</div>
    <textarea id="ab-hull-debug-vertices" readonly spellcheck="false">${escapeHtml(result.vertexText)}</textarea>
    <div class="ab-union-section-title">experiment json</div>
    <textarea id="ab-hull-debug-export-json" readonly spellcheck="false">${escapeHtml(formatAbHullDebugExports(abHullDebugState))}</textarea>
  `;
  }

  function renderHullDebugFrame(): void {
    deps.ctx.clearRect(0, 0, config.canvasSize, config.canvasSize);
    const result = renderAbHullDebug(deps.ctx, abHullDebugState);
    currentAbHullDebugResult = result;
    deps.gammaValues.textContent = `hull debug: a=${formatAbHullDebugParameter(abHullDebugState.a)}, b=${formatAbHullDebugParameter(abHullDebugState.b)}, a+b=${formatAbHullDebugParameter(abHullDebugState.a + abHullDebugState.b)}`;
    deps.localCBounds.textContent = 'local view: full hex footprint in u,v coordinates';
    deps.localCValues.textContent = result.closed
      ? result.missedCount === 0
        ? 'drawn polygon contains sampled exact set'
        : `drawn polygon misses ${result.missedCount} sampled points`
      : 'click vertices, then close polygon';
    deps.ceStatus.textContent = 'Hull debug: diagnostic drawing mode';
    deps.ceStatus.style.color = '#475569';
    deps.ceChainStatus.textContent = 'Snaps to hex-axis directions: u, v, and u-v';
    deps.ceChainStatus.style.color = '#475569';
    deps.coverOverlayStatus.textContent = 'Hull debug does not change ab union masks';
    deps.coverOverlayStatus.style.color = '#64748b';
    deps.regionRenderer.render();
    renderAbHullDebugPanel(result);
    return;
  }

  function bindHullControls(): void {
    deps.abUnionControls.addEventListener('click', async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.dataset.hullDebugClose !== undefined) {
        closeAbHullDebugPolygon(abHullDebugState);
        deps.render();
        return;
      }
      if (target.dataset.hullDebugUndo !== undefined) {
        undoAbHullDebugVertex(abHullDebugState);
        deps.render();
        return;
      }
      if (target.dataset.hullDebugDelete !== undefined) {
        deleteSelectedAbHullDebugVertex(abHullDebugState);
        deps.render();
        return;
      }
      if (target.dataset.hullDebugClear !== undefined) {
        clearAbHullDebugPolygon(abHullDebugState);
        deps.render();
        return;
      }
      if (target.dataset.hullDebugReset !== undefined) {
        resetAbHullDebugExample(abHullDebugState);
        deps.render();
        return;
      }
      if (target.dataset.hullDebugSuggested !== undefined) {
        loadSuggestedAbHullDebugPolygon(abHullDebugState);
        deps.render();
        return;
      }
      if (target.dataset.hullDebugExport !== undefined) {
        if (currentAbHullDebugResult) {
          exportAbHullDebugExperiment(abHullDebugState, currentAbHullDebugResult);
        }
        deps.render();
        return;
      }
      if (target.dataset.hullDebugClearExports !== undefined) {
        clearAbHullDebugExports(abHullDebugState);
        deps.render();
        return;
      }
      if (target.dataset.hullDebugCopyExports !== undefined) {
        const exportCount = abHullDebugState.exports.length;
        if (exportCount === 0) {
          abHullDebugState.status = 'No exported experiments to copy.';
          deps.render();
          return;
        }
        try {
          await navigator.clipboard.writeText(formatAbHullDebugExports(abHullDebugState));
          abHullDebugState.status = `Copied ${exportCount} exported experiment${exportCount === 1 ? '' : 's'} as JSON.`;
          deps.render();
        } catch {
          abHullDebugState.status = 'Clipboard unavailable. JSON selected for manual copy.';
          deps.render();
          const textarea = document.getElementById('ab-hull-debug-export-json') as HTMLTextAreaElement | null;
          textarea?.focus();
          textarea?.select();
        }
        return;
      }
    });

    deps.abUnionControls.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const debugParam = target.dataset.hullDebugParam;
      if (isAbHullDebugParam(debugParam)) {
        if (target.type === 'number') return;
        setAbHullDebugParameter(abHullDebugState, debugParam, Number(target.value));
        syncAbHullDebugParameterControls();
        return;
      }
    });

    deps.abUnionControls.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return; const target = event.target; if (!(target instanceof HTMLInputElement)) return;
      if (!applyAbHullDebugParameterInput(target)) return;
      deps.render();
      event.preventDefault();
    });

    deps.abUnionControls.addEventListener('wheel', (event) => {
      const target = event.target; if (!(target instanceof HTMLInputElement)) return;
      if (deps.shapeMode !== 'ab-hull-debug') return;
      const debugParam = target.dataset.hullDebugParam;
      if (!isAbHullDebugParam(debugParam) || event.deltaY === 0) return;
      const direction = event.deltaY < 0 ? 1 : -1;
      setAbHullDebugParameter(
        abHullDebugState,
        debugParam,
        abHullDebugState[debugParam] + direction * AB_HULL_DEBUG_WHEEL_STEP,
      );
      deps.render();
      event.preventDefault();
    });

    deps.abUnionControls.addEventListener('change', (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement && applyAbHullDebugParameterInput(target)) {
        deps.render();
        return;
      }
    });

    setupAbHullDebugInteraction(
      deps.canvas,
      () => deps.shapeMode === 'ab-hull-debug',
      () => abHullDebugState,
      deps.render,
    );
  }

  return {
    renderHullDebugFrame,
    bindHullControls
  };
}

