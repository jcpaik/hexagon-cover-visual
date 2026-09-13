import type { AbUnionEdgeDots } from '../ab-union/types';
import { pointOnEdge } from '../ab-union/geometry';
import { mathToCanvas } from '../coords';

// This is a one-dimensional annotation, not a clipping of the source regions.
// Draw it AFTER all filled witness/candidate overlays, then draw the handles.
export function drawStrategy3GapTraces(ctx: CanvasRenderingContext2D, edges: readonly AbUnionEdgeDots[]): void {
  ctx.save();
  ctx.lineCap = 'butt';
  edges.forEach((edge, index) => {
    if (!edge.split) return;
    const left = mathToCanvas(pointOnEdge(index, edge.left));
    const right = mathToCanvas(pointOnEdge(index, edge.right));
    ctx.beginPath();
    if (edge.left === edge.right) ctx.arc(left.x, left.y, 9, 0, 2 * Math.PI);
    else {
      ctx.moveTo(left.x, left.y);
      ctx.lineTo(right.x, right.y);
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 3;
    ctx.setLineDash(edge.left === edge.right ? [] : [4, 3]);
    ctx.stroke();
  });
  ctx.restore();
}

// Edge membership is read from trace-exact endpoint constraints, never from
// area pixels. A split edge remains a gap even when its two handles coincide.
export function gapTraceLegend(edges: readonly AbUnionEdgeDots[], colors: readonly string[]): string {
  return edges.flatMap((edge, index) => {
    if (!edge.split) return [];
    const next = (index + 1) % 6;
    const left = edge.left.toFixed(6), right = edge.right.toFixed(6);
    const xLeft = 12 + 260 * edge.left, xRight = 12 + 260 * edge.right;
    const label = `e${index}: V${index} stops at t=${left}; ${edge.left === edge.right ? 'singleton gap' : `gap to t=${right}`}; V${next} starts at t=${right}`;
    return [`<div class="free-small-status" data-strategy3-gap-edge="${index}">
      <div>${label}</div>
      <svg viewBox="0 0 284 28" style="width:100%;max-width:300px;height:28px" role="img" aria-label="${label}">
        <path d="M12 14H${xLeft}" stroke="${colors[index]}" stroke-width="4"/>
        <path d="M${xRight} 14H272" stroke="${colors[next]}" stroke-width="4"/>
        <path d="M${xLeft} 14H${xRight}" stroke="#dc2626" stroke-width="3" stroke-dasharray="4 3"/>
        ${[...new Set([xLeft, xRight])].map((x) => `<circle cx="${x}" cy="14" r="4" fill="white" stroke="#dc2626" stroke-width="2"/>`).join('')}
      </svg>
      <div>Open V traces exclude both gap endpoints; C must cover the closed gap under a cover.</div>
    </div>`];
  }).join('');
}
