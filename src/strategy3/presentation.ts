import type { Point } from '../types';
import type { BoundaryRole } from './boundary';
import type { Strategy3Mode } from './state';
import { HEXAGON_VERTICES } from '../hexagon';
import { canvasToMath, config, mathToCanvas } from '../coords';
import { pointInHex, pointOnEdge } from '../ab-union/geometry';
import { AB_UNION_REGION_COLORS } from '../ab-union/render';
import { findRestrictedAbSource } from '../ab-union/feasibility';
import { rasterizePolygonUnion, sourceCoveragePolygons } from '../ab-union/sampledMask';
import { escapeHtml } from '../app/format';
import { compareSourceFamilies, inspectSourcePoint, sourceMeasurements, INTERIOR_DIFFERENCE_DEMO,
  type InspectionQuery, type SourceInspection } from './sourceInspection';

interface Layers { fills: boolean; outlines: boolean; hull: boolean; triangle: boolean; triangleFill: boolean }
interface ViewState {
  kind: 'witness' | 'sources'; role: number; solo: boolean; inspect: boolean; demo: boolean;
  layers: Layers; query: InspectionQuery | null;
}
interface Dependencies {
  canvas: HTMLCanvasElement; controls: HTMLDivElement;
  mode: () => Strategy3Mode | null; render: () => void;
}
const defaults = (mode: Strategy3Mode): ViewState => ({
  kind: 'witness', role: mode === 'f' ? 4 : 0, solo: true, inspect: false, demo: false,
  layers: { fills: false, outlines: false, hull: true, triangle: true, triangleFill: false }, query: null,
});
const number = (value: number) => value.toFixed(6);
const restrictions = (role: BoundaryRole | typeof INTERIOR_DIFFERENCE_DEMO.role) =>
  `A ${role.restriction === 'in' || role.restriction === 'both' ? '=' : '≥'} ${number(role.a)}; B ${role.restriction === 'out' || role.restriction === 'both' ? '=' : '≥'} ${number(role.b)}`;

export function createStrategy3Presentation(deps: Dependencies) {
  let views = { bc: defaults('bc'), d: defaults('d'), f: defaults('f') };
  let comparison: ReturnType<typeof compareSourceFamilies> | null = null;
  let comparisonKey = '';
  let results: [SourceInspection, SourceInspection] | null = null;
  const current = () => views[deps.mode() ?? 'bc'];
  const inspectsCanvas = () => deps.mode() !== null && current().kind === 'sources' && current().inspect && !current().demo;

  deps.canvas.addEventListener('pointerup', (event) => {
    if (!inspectsCanvas() || !event.isPrimary) return;
    const rect = deps.canvas.getBoundingClientRect();
    const point = canvasToMath({ x: (event.clientX - rect.left) * config.canvasSize / rect.width,
      y: (event.clientY - rect.top) * config.canvasSize / rect.height });
    let query: InspectionQuery = { point };
    let nearest = 4 / config.scale;
    for (let i = 0; i < 6; i++) {
      const a = HEXAGON_VERTICES[i], b = HEXAGON_VERTICES[(i + 1) % 6];
      const t = Math.max(0, Math.min(1, (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y)));
      const snapped = pointOnEdge(i, t), distance = Math.hypot(point.x - snapped.x, point.y - snapped.y);
      if (distance < nearest) { nearest = distance; query = { point: snapped, edge: { index: i, t } }; }
    }
    if (!query.edge && !pointInHex(point)) return;
    current().query = query;
    deps.render();
  });

  function inspectCoordinates(): boolean {
    const inputs = ['[data-s3-x]', '[data-s3-y]'].map((selector) => deps.controls.querySelector<HTMLInputElement>(selector));
    if (inputs.some((input) => !input || !input.reportValidity() || !input.value.trim())) return false;
    const [x, y] = inputs.map((input) => Number(input!.value));
    if (![x, y].every(Number.isFinite)) return false;
    current().query = { point: { x, y } };
    return true;
  }
  deps.controls.addEventListener('keydown', (event) => {
    if (!deps.mode() || event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)
      || !event.target.matches('[data-s3-x], [data-s3-y]')) return;
    event.preventDefault();
    if (inspectCoordinates()) deps.render();
  });

  deps.controls.addEventListener('click', (event) => {
    if (!deps.mode() || !(event.target instanceof HTMLElement)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-s3-view], [data-s3-inspect], [data-s3-demo]');
    if (!button) return;
    const view = current();
    if (button.dataset.s3View === 'witness' || button.dataset.s3View === 'sources') {
      view.kind = button.dataset.s3View;
      view.inspect = false;
      view.layers = view.kind === 'witness'
        ? { fills: false, outlines: false, hull: true, triangle: true, triangleFill: false }
        : { fills: true, outlines: true, hull: false, triangle: false, triangleFill: false };
    } else if (button.dataset.s3Demo !== undefined) {
      view.demo = !view.demo;
      view.query = view.demo ? { point: { ...INTERIOR_DIFFERENCE_DEMO.point } } : null;
    } else if (!inspectCoordinates()) return;
    deps.render();
  });
  deps.controls.addEventListener('change', (event) => {
    if (!deps.mode()) return;
    const input = event.target, view = current();
    if (input instanceof HTMLSelectElement && input.dataset.s3Role !== undefined) {
      view.role = Number(input.value); view.demo = false;
    } else if (input instanceof HTMLInputElement && input.dataset.s3Layer) {
      const key = input.dataset.s3Layer as keyof Layers;
      if (!(key in view.layers)) return;
      view.layers[key] = input.checked;
    } else if (input instanceof HTMLInputElement && input.dataset.s3Solo !== undefined) view.solo = input.checked;
    else if (input instanceof HTMLInputElement && input.dataset.s3CanvasInspect !== undefined) view.inspect = input.checked;
    else return;
    deps.render();
  });

  function inspectPanel(result: SourceInspection, role: ReturnType<typeof compareSourceFamilies>['role']): string {
    const metrics = result.triangle ? sourceMeasurements(role, result.triangle) : null;
    return `<div class="free-small-status" data-inspection-status="${result.status}" role="status"><strong>${result.status === 'found' ? 'Source found' : result.status === 'excluded' ? 'Analytic obstruction' : 'Unresolved'}</strong>: ${escapeHtml(result.reason)}
      ${result.lowerBound === undefined ? '' : `<br>Required side ≥ ${number(result.lowerBound)} &gt; 1.`}
      ${metrics ? `<br>Measured A=${number(metrics.a)}, B=${number(metrics.b)}, A+B=${number(metrics.a + metrics.b)}.<br>Minimum required interior clearance: ${metrics.interiorMargin.toExponential(3)}.` : ''}</div>`;
  }

  function drawPanel(canvas: HTMLCanvasElement, family: ReturnType<typeof compareSourceFamilies>['restricted'], result: SourceInspection | null, view: ViewState): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const size = canvas.width, center = size / 2, scale = size * .4;
    const toCanvas = (p: Point) => ({ x: center + scale * p.x, y: center - scale * p.y });
    const mask = rasterizePolygonUnion(sourceCoveragePolygons(family), { size, center, scale });
    const image = ctx.createImageData(size, size);
    const color = AB_UNION_REGION_COLORS[view.demo ? 0 : view.role];
    const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    for (let i = 0; i < mask.length; i++) {
      const p = { x: (i % size + .5 - center) / scale, y: (center - Math.floor(i / size) - .5) / scale };
      if (mask[i] && pointInHex(p)) { image.data.set([...rgb, 75], 4 * i); }
    }
    ctx.clearRect(0, 0, size, size); ctx.putImageData(image, 0, 0);
    const path = (polygon: readonly Point[], color: string, dashed = false) => {
      ctx.beginPath(); const points = polygon.map(toCanvas);
      ctx.moveTo(points[0].x, points[0].y); points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.closePath();
      ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.setLineDash(dashed ? [4, 2] : []); ctx.stroke(); ctx.setLineDash([]);
    };
    path(HEXAGON_VERTICES, '#64748b');
    if (result?.triangle) path(result.triangle, '#111827', true);
    if (view.query) {
      const p = toCanvas(view.query.point); ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#111827'; ctx.stroke();
    }
  }

  function renderControls(mode: Strategy3Mode, roles: BoundaryRole[], seeds: readonly (Point[] | null)[], quality: 'preview' | 'full'): void {
    const view = views[mode], host = deps.controls.querySelector<HTMLElement>('[data-s3-presentation]');
    if (!host) return;
    let panels = '';
    if (view.kind === 'sources') {
      const role = view.demo ? INTERIOR_DIFFERENCE_DEMO.role : roles[view.role];
      const seed = view.demo ? findRestrictedAbSource(role) : seeds[view.role];
      const key = JSON.stringify([role, quality, seed]);
      if (key !== comparisonKey) { comparison = compareSourceFamilies(role, quality, seed); comparisonKey = key; }
      results = view.query ? [inspectSourcePoint(comparison!.relaxedRole, comparison!.relaxed, view.query),
        inspectSourcePoint(role, comparison!.restricted, view.query)] : null;
      panels = `<fieldset><legend>One-role comparison and point inspector</legend>
        <label>Compare V role <select data-s3-role aria-label="Compare V role">${roles.map((_, i) => `<option value="${i}"${view.role === i ? ' selected' : ''}>V${i}</option>`).join('')}</select></label>
        <label><input type="checkbox" data-s3-solo${view.solo ? ' checked' : ''}/>Solo this role on main canvas</label>
        <p class="free-small-status">${view.demo ? '<strong>Isolated local demo: a=3/4, b=1/8. The live boundary handles and witnesses are unchanged.</strong>' : `Live V${view.role}: ${restrictions(role)}.`}
        Same ${role.criticality} rule, ${role.requiredInteriorPoints.length} additional interior anchor(s), and 1e-9 side clearance in both panels. Only endpoint equalities are relaxed.
        ${role.restriction === 'ordinary' ? 'This role has no exact endpoint: the two families coincide.' : ''}</p>
        <button type="button" class="free-button" data-s3-demo>${view.demo ? 'Return to live inputs' : 'Interior-difference demo'}</button>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${['Endpoint relaxed', 'Actual endpoint fixed'].map((name, i) => `<section style="flex:1;min-width:180px"><strong>${name}</strong>
          <canvas width="280" height="280" data-s3-comparison="${i}" style="width:100%;max-width:320px;display:block;background:white;border:1px solid #cbd5e1" aria-label="${name} source family"></canvas>
          ${results ? inspectPanel(results[i], i === 0 ? comparison!.relaxedRole : role) : '<p class="free-small-status">Click either panel to inspect the same point in both.</p>'}</section>`).join('')}
        </div>
        <div class="free-toolbar"><label>x <input type="number" required step="any" data-s3-x aria-label="Inspect x" value="${view.query?.point.x ?? 0}" style="width:100px"/></label>
        <label>y <input type="number" required step="any" data-s3-y aria-label="Inspect y" value="${view.query?.point.y ?? 0}" style="width:100px"/></label>
        <button type="button" class="free-button" data-s3-inspect>Inspect point</button></div>
        <label><input type="checkbox" data-s3-canvas-inspect${view.inspect ? ' checked' : ''}${view.demo ? ' disabled' : ''}/>Inspect on main canvas instead of dragging handles</label>
        <p class="free-small-status">${view.query?.edge ? `Snapped to e${view.query.edge.index}, t=${number(view.query.edge.t)}. ` : ''}Closed sources may contain stopping endpoints; original open V traces exclude them. A sampled miss is unresolved, not a proof of exclusion. Analytic tests are evaluated in floating point. A dashed black triangle is one validated source, not the whole union.</p>
      </fieldset>`;
    } else results = null;
    host.innerHTML = `<div class="free-toolbar" role="group" aria-label="Strategy 3 view">
      <button class="free-button" type="button" data-s3-view="witness" aria-pressed="${view.kind === 'witness'}">Witness argument</button>
      <button class="free-button" type="button" data-s3-view="sources" aria-pressed="${view.kind === 'sources'}">Source-family explorer</button></div>
      <p class="free-small-status"><strong>Witness provenance:</strong> ${mode === 'f' ? 'Canonical nine-point formula; only enabled points are fitted.' : 'Capacity-derived radial substitutes, not measured actual V-triangle frontiers.'}
      <br><strong>Local source existence:</strong> ${seeds.filter(Boolean).length}/6 roles have a numerically validated source.
      <br><strong>Global covering hypotheses:</strong> NOT VERIFIED. Independent sources are not a jointly realized cover.
      <br><strong>Enclosure:</strong> exhaustive hull-edge calipers, floating-point evaluation; a near-one value is not a certified inequality.</p>
      ${view.kind === 'witness' ? '<p class="free-small-status">Actual traces force the gap endpoints under a hypothetical cover. Analytic capacities bound the radial witnesses. The finite witness set is fixed before any candidate enclosure is fitted; a fit is not a realized C triangle.</p>' : '<p class="free-small-status">Each source-family point may need a different triangle. Unshaded pixels do not prove exclusion from the full infinite family. Comparing one role avoids other V regions hiding the difference.</p>'}
      <div class="free-toolbar">${([['fills', 'Source fills'], ['outlines', 'Source outlines'], ['hull', 'Witness hull'], ['triangle', 'Enclosing candidate'], ['triangleFill', 'Candidate fill']] as const).map(([key, label]) =>
        `<label><input type="checkbox" data-s3-layer="${key}"${view.layers[key] ? ' checked' : ''}/>${label}</label>`).join('')}</div>${panels}`;
    if (view.kind === 'sources' && comparison) {
      const canvases = host.querySelectorAll<HTMLCanvasElement>('[data-s3-comparison]');
      canvases.forEach((canvas, i) => {
        drawPanel(canvas, i === 0 ? comparison!.relaxed : comparison!.restricted, results?.[i] ?? null, view);
        canvas.addEventListener('click', (event) => {
          const rect = canvas.getBoundingClientRect(), size = canvas.width;
          view.query = { point: { x: ((event.clientX - rect.left) * size / rect.width - size / 2) / (size * .4),
            y: (size / 2 - (event.clientY - rect.top) * size / rect.height) / (size * .4) } };
          deps.render();
        });
      });
    }
  }

  function drawInspection(ctx: CanvasRenderingContext2D): void {
    const view = current();
    if (view.kind !== 'sources' || view.demo || !view.query) return;
    const result = results?.[1];
    ctx.save(); ctx.strokeStyle = '#111827'; ctx.lineWidth = 2;
    if (result?.triangle) {
      ctx.beginPath(); const points = result.triangle.map(mathToCanvas);
      ctx.moveTo(points[0].x, points[0].y); points.slice(1).forEach((p) => ctx.lineTo(p.x, p.y)); ctx.closePath();
      ctx.setLineDash([5, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
    const p = mathToCanvas(view.query.point); ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); ctx.restore();
  }
  return {
    current, inspectsCanvas, renderControls, drawInspection,
    reset() { views = { bc: defaults('bc'), d: defaults('d'), f: defaults('f') }; comparison = null; comparisonKey = ''; results = null; },
  };
}
