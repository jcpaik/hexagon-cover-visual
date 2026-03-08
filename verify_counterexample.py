#!/usr/bin/env python3
from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal, getcontext
from pathlib import Path


getcontext().prec = 160

STRICT_TOL = Decimal("1e-80")
BRACKET_SAMPLES = 512
BINARY_SEARCH_STEPS = 220
WITNESS_X = Decimal("0.1115")
SVG_PATH = Path("verify_counterexample.svg")
CERTIFICATE_PATH = Path("counterexample_certificate.py")
GRAPH_SAMPLES = 81


@dataclass(frozen=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True)
class TriangleState:
    position: Point
    angle: float


SNAPSHOT_STATE = TriangleState(
    position=Point(x=-0.025104244119199516, y=-0.4256560418598985),
    angle=-0.10228093308280761,
)


def clamp01_decimal(value: Decimal) -> Decimal:
    return max(Decimal(0), min(Decimal(1), value))


def decimal_sqrt(value: Decimal) -> Decimal:
    if value <= 0:
        return Decimal(0)
    return value.sqrt()


def ordered_admissible(a: Decimal, b: Decimal, c: Decimal, tol: Decimal = STRICT_TOL) -> bool:
    sum_ab = a + b
    circle = a * a + a * b + b * b
    if circle > Decimal(1) + tol:
        return False

    transition = sum_ab**4 - sum_ab * sum_ab + a * b
    cell1 = (
        sum_ab <= Decimal(1) + tol
        and transition <= tol
        and c**4 - c * c + a * c - a * a <= tol
    )
    cell2 = (
        sum_ab <= Decimal(1) + tol
        and transition >= -tol
        and (sum_ab * sum_ab - Decimal(1)) * c * c + b * c - b * b <= tol
    )
    cell3 = (
        sum_ab >= Decimal(1) - tol
        and c <= Decimal("0.5") + tol
        and (a * a - Decimal(1)) * c * c
        + (Decimal(2) * a * b * b + b) * c
        + (b**4 - b * b)
        <= tol
    )
    return cell1 or cell2 or cell3


def admissible(
    a_input: Decimal,
    b_input: Decimal,
    c_input: Decimal,
    tol: Decimal = STRICT_TOL,
) -> bool:
    a = clamp01_decimal(a_input)
    b = clamp01_decimal(b_input)
    c = clamp01_decimal(c_input)
    if a <= b + tol:
        return ordered_admissible(a, b, c, tol)
    return ordered_admissible(b, a, c, tol)


def circle_arc_bound(a_input: Decimal) -> Decimal:
    a = clamp01_decimal(a_input)
    disc = max(Decimal(0), Decimal(4) - Decimal(3) * a * a)
    return clamp01_decimal((-a + decimal_sqrt(disc)) / Decimal(2))


def max_coverage_bracket(
    a_input: Decimal,
    c_input: Decimal,
    tol: Decimal = STRICT_TOL,
) -> tuple[Decimal, Decimal]:
    a = clamp01_decimal(a_input)
    c = clamp01_decimal(c_input)
    upper = circle_arc_bound(a)

    if upper <= tol:
        return Decimal(0), Decimal(0)

    if admissible(a, upper, c, tol):
        return upper, upper

    step = upper / Decimal(BRACKET_SAMPLES)
    lo = Decimal("-1")
    hi = upper

    for i in range(BRACKET_SAMPLES - 1, -1, -1):
        b = step * Decimal(i)
        if admissible(a, b, c, tol):
            lo = b
            hi = min(upper, b + step)
            break

    if lo < 0:
        return Decimal(0), hi

    for _ in range(BINARY_SEARCH_STEPS):
        mid = (lo + hi) / Decimal(2)
        if admissible(a, mid, c, tol):
            lo = mid
        else:
            hi = mid

    return lo, hi


def hexagon_rays() -> list[Point]:
    return [Point(x=math.cos(i * math.pi / 3), y=math.sin(i * math.pi / 3)) for i in range(6)]


def triangle_vertices(state: TriangleState) -> list[Point]:
    circumradius = 1 / math.sqrt(3)
    vertices: list[Point] = []
    for k in range(3):
        angle = state.angle + math.pi / 2 + k * (2 * math.pi / 3)
        vertices.append(
            Point(
                x=state.position.x + circumradius * math.cos(angle),
                y=state.position.y + circumradius * math.sin(angle),
            )
        )
    return vertices


def subtract(a: Point, b: Point) -> Point:
    return Point(x=a.x - b.x, y=a.y - b.y)


def cross(a: Point, b: Point) -> float:
    return a.x * b.y - a.y * b.x


def ray_segment_intersection_distance(origin: Point, direction: Point, a: Point, b: Point) -> float | None:
    dir_length = math.hypot(direction.x, direction.y)
    if dir_length == 0:
        return None

    unit_direction = Point(x=direction.x / dir_length, y=direction.y / dir_length)
    edge = subtract(b, a)
    offset = subtract(a, origin)
    denom = cross(unit_direction, edge)
    eps = 1e-12

    if abs(denom) < eps:
        return None

    ray_t = cross(offset, edge) / denom
    seg_t = cross(offset, unit_direction) / denom
    if ray_t < -eps or seg_t < -eps or seg_t > 1 + eps:
        return None

    return max(ray_t, 0.0)


def ray_polygon_exit_distance(origin: Point, direction: Point, polygon: list[Point]) -> float | None:
    best: float | None = None
    for i in range(len(polygon)):
        hit = ray_segment_intersection_distance(origin, direction, polygon[i], polygon[(i + 1) % len(polygon)])
        if hit is None:
            continue
        if best is None or hit < best:
            best = hit
    return best


def derive_local_cs(state: TriangleState) -> list[Decimal]:
    origin = Point(0.0, 0.0)
    polygon = triangle_vertices(state)
    local_cs: list[Decimal] = []
    for ray in hexagon_rays():
        gamma = ray_polygon_exit_distance(origin, ray, polygon) or 0.0
        local_c = max(0.0, 1.0 - gamma)
        local_cs.append(Decimal(repr(local_c)))
    return local_cs


def fmt(value: Decimal) -> str:
    return f"{value:.30f}"


def fmt_scientific(value: Decimal) -> str:
    return f"{value:.6E}"


def full_decimal(value: Decimal) -> str:
    return format(value, "f")


def compose_local_cs(local_cs: list[Decimal], x: Decimal) -> Decimal:
    current = clamp01_decimal(x)
    for c_value in local_cs:
        b_lo, _ = max_coverage_bracket(current, c_value, STRICT_TOL)
        current = Decimal(1) - b_lo
    return current


def svg_canvas_point(
    point: Point,
    panel_left: float,
    panel_top: float,
    panel_size: float,
    scale: float,
) -> tuple[float, float]:
    center_x = panel_left + panel_size / 2
    center_y = panel_top + panel_size / 2
    return center_x + scale * point.x, center_y - scale * point.y


def export_svg(local_cs: list[Decimal], witness_x: Decimal, witness_y: Decimal) -> None:
    width = 1080
    height = 560
    left = 40.0
    top = 60.0
    panel_size = 420.0
    scale = 155.0
    right_left = 600.0
    graph_pad = 48.0
    graph_size = 320.0

    hexagon = hexagon_rays()
    triangle = triangle_vertices(SNAPSHOT_STATE)
    graph_points: list[tuple[float, float]] = []
    for index in range(GRAPH_SAMPLES):
        x = Decimal(index) / Decimal(GRAPH_SAMPLES - 1)
        y = compose_local_cs(local_cs, x)
        graph_points.append((float(x), float(y)))

    lines: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<style>',
        'text { font-family: monospace; fill: #0f172a; }',
        '.small { font-size: 12px; }',
        '.label { font-size: 13px; }',
        '.title { font-size: 16px; font-weight: 600; }',
        '</style>',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
        f'<text x="{left}" y="28" class="title">Counterexample verification</text>',
        f'<text x="{left}" y="46" class="small">x = {fmt(witness_x)},  G(x) = {fmt(witness_y)},  G(x) - x = {fmt(witness_y - witness_x)}</text>',
        f'<text x="{left}" y="{top - 18}" class="label">Triangle and c_i values</text>',
        f'<rect x="{left}" y="{top}" width="{panel_size}" height="{panel_size}" fill="#fff" stroke="#cbd5e1"/>',
    ]

    hexagon_path = []
    for i, vertex in enumerate(hexagon):
        x, y = svg_canvas_point(vertex, left, top, panel_size, scale)
        command = "M" if i == 0 else "L"
        hexagon_path.append(f"{command} {x:.3f} {y:.3f}")
    hexagon_path.append("Z")
    lines.append(f'<path d="{" ".join(hexagon_path)}" fill="none" stroke="#0f172a" stroke-width="1.5"/>')

    triangle_path = []
    for i, vertex in enumerate(triangle):
        x, y = svg_canvas_point(vertex, left, top, panel_size, scale)
        command = "M" if i == 0 else "L"
        triangle_path.append(f"{command} {x:.3f} {y:.3f}")
    triangle_path.append("Z")
    lines.append(
        f'<path d="{" ".join(triangle_path)}" fill="rgba(137,207,240,0.14)" stroke="#0891b2" stroke-width="2"/>'
    )

    origin = Point(0.0, 0.0)
    for i, vertex in enumerate(hexagon):
        x1, y1 = svg_canvas_point(origin, left, top, panel_size, scale)
        x2, y2 = svg_canvas_point(vertex, left, top, panel_size, scale)
        lines.append(f'<line x1="{x1:.3f}" y1="{y1:.3f}" x2="{x2:.3f}" y2="{y2:.3f}" stroke="#e2e8f0" stroke-width="1.5"/>')

        label_point = Point(vertex.x * 0.72, vertex.y * 0.72)
        lx, ly = svg_canvas_point(label_point, left, top, panel_size, scale)
        lines.append(f'<text x="{lx:.3f}" y="{ly:.3f}" class="small">c_{i} = {float(local_cs[i]):.6f}</text>')

    ox, oy = svg_canvas_point(origin, left, top, panel_size, scale)
    lines.append(f'<circle cx="{ox:.3f}" cy="{oy:.3f}" r="4" fill="#dc2626"/>')

    lines.extend(
        [
            f'<text x="{right_left}" y="{top - 18}" class="label">Composition graph</text>',
            f'<rect x="{right_left}" y="{top}" width="{panel_size}" height="{panel_size}" fill="#fff" stroke="#cbd5e1"/>',
        ]
    )

    gx0 = right_left + graph_pad
    gy0 = top + panel_size - graph_pad
    gx1 = right_left + panel_size - graph_pad
    gy1 = top + graph_pad

    for tick in [0.25, 0.5, 0.75]:
        px = gx0 + (gx1 - gx0) * tick
        py = gy0 - (gy0 - gy1) * tick
        lines.append(f'<line x1="{px:.3f}" y1="{gy1:.3f}" x2="{px:.3f}" y2="{gy0:.3f}" stroke="#e2e8f0" stroke-width="1"/>')
        lines.append(f'<line x1="{gx0:.3f}" y1="{py:.3f}" x2="{gx1:.3f}" y2="{py:.3f}" stroke="#e2e8f0" stroke-width="1"/>')

    lines.append(f'<rect x="{gx0:.3f}" y="{gy1:.3f}" width="{gx1 - gx0:.3f}" height="{gy0 - gy1:.3f}" fill="none" stroke="#94a3b8" stroke-width="1.5"/>')
    lines.append(f'<line x1="{gx0:.3f}" y1="{gy0:.3f}" x2="{gx1:.3f}" y2="{gy1:.3f}" stroke="#cbd5e1" stroke-dasharray="6 6" stroke-width="1.5"/>')

    graph_path = []
    for i, (x, y) in enumerate(graph_points):
        px = gx0 + (gx1 - gx0) * x
        py = gy0 - (gy0 - gy1) * y
        graph_path.append(f'{"M" if i == 0 else "L"} {px:.3f} {py:.3f}')
    lines.append(f'<path d="{" ".join(graph_path)}" fill="none" stroke="#b45309" stroke-width="2.5"/>')

    wx = float(witness_x)
    wy = float(witness_y)
    wpx = gx0 + (gx1 - gx0) * wx
    wpy = gy0 - (gy0 - gy1) * wy
    wax = gx0 + (gx1 - gx0) * wx
    way = gy0 - (gy0 - gy1) * wx
    lines.append(f'<line x1="{wax:.3f}" y1="{way:.3f}" x2="{wpx:.3f}" y2="{wpy:.3f}" stroke="#dc2626" stroke-dasharray="4 4" stroke-width="1.5"/>')
    lines.append(f'<circle cx="{wpx:.3f}" cy="{wpy:.3f}" r="5" fill="#dc2626"/>')
    lines.append(f'<text x="{gx0:.3f}" y="{top + panel_size + 24:.3f}" class="small">identity: gray dashed, G: orange, witness: red</text>')
    lines.append(f'<text x="{gx0:.3f}" y="{top + panel_size + 42:.3f}" class="small">witness = ({wx:.6f}, {wy:.6f})</text>')

    lines.append('</svg>')
    SVG_PATH.write_text("\n".join(lines), encoding="utf-8")


def build_steps(local_cs: list[Decimal], witness_x: Decimal) -> list[dict[str, Decimal]]:
    steps: list[dict[str, Decimal]] = []
    current_a = witness_x

    for c_value in local_cs:
        b_lo, b_hi = max_coverage_bracket(current_a, c_value, STRICT_TOL)
        next_a_lo = Decimal(1) - b_hi
        next_a_hi = Decimal(1) - b_lo
        next_a = Decimal(1) - b_lo
        steps.append(
            {
                "a": current_a,
                "b_lo": b_lo,
                "b_hi": b_hi,
                "c": c_value,
                "a_next_lo": next_a_lo,
                "a_next_hi": next_a_hi,
                "a_next": next_a,
            }
        )
        current_a = next_a

    return steps


def write_certificate(local_cs: list[Decimal], witness_x: Decimal, steps: list[dict[str, Decimal]]) -> None:
    lines = [
        "from decimal import Decimal",
        "",
        "",
        "def D(x: str) -> Decimal:",
        "    return Decimal(x)",
        "",
        "",
        f"STRICT_TOL = D('{full_decimal(STRICT_TOL)}')",
        f"witness_x = D('{full_decimal(witness_x)}')",
        "local_cs = [",
    ]
    for value in local_cs:
        lines.append(f"    D('{full_decimal(value)}'),")
    lines.extend(
        [
            "]",
            "",
            "steps = [",
        ]
    )
    for step in steps:
        lines.extend(
            [
                "    {",
                f"        'a': D('{full_decimal(step['a'])}'),",
                f"        'b': D('{full_decimal(step['b_lo'])}'),",
                f"        'b_hi': D('{full_decimal(step['b_hi'])}'),",
                f"        'c': D('{full_decimal(step['c'])}'),",
                f"        'a_next': D('{full_decimal(step['a_next'])}'),",
                f"        'a_next_lo': D('{full_decimal(step['a_next_lo'])}'),",
                f"        'a_next_hi': D('{full_decimal(step['a_next_hi'])}'),",
                "    },",
            ]
        )
    lines.extend(
        [
            "]",
            "",
        ]
    )
    CERTIFICATE_PATH.write_text("\n".join(lines), encoding="utf-8")


def verify_counterexample(local_cs: list[Decimal], witness_x: Decimal) -> Decimal:
    steps = build_steps(local_cs, witness_x)
    current_a = witness_x
    print(f"witness_x = {fmt(witness_x)}")
    print("c_i values:")
    for index, c_value in enumerate(local_cs):
        print(f"  c_{index} = {fmt(c_value)}")

    print("\nstep data:")
    for index, step in enumerate(steps):
        bracket_width = step["b_hi"] - step["b_lo"]

        print(f"  step {index}:")
        print(f"    a_{index}        = {fmt(current_a)}")
        print(f"    c_{index}        = {fmt(step['c'])}")
        print(f"    b_{index}_lo     = {fmt(step['b_lo'])}  (admissible)")
        print(f"    b_{index}_hi     = {fmt(step['b_hi'])}  (inadmissible upper bracket)")
        print(f"    b_{index}_width  = {fmt_scientific(bracket_width)}")
        print(f"    a_{index + 1}_lo = {fmt(step['a_next_lo'])}")
        print(f"    a_{index + 1}_hi = {fmt(step['a_next_hi'])}")
        current_a = step["a_next"]

    final_gap = current_a - witness_x
    print("\nsummary:")
    print(f"  G(x) ~= {fmt(current_a)}")
    print(f"  G(x) - x ~= {fmt(final_gap)}")
    if final_gap > Decimal(0):
        print("  verdict: COUNTEREXAMPLE VERIFIED NUMERICALLY")
    else:
        print("  verdict: no counterexample at this witness")
    write_certificate(local_cs, witness_x, steps)
    return current_a


def main() -> None:
    local_cs = derive_local_cs(SNAPSHOT_STATE)
    witness_y = verify_counterexample(local_cs, WITNESS_X)
    export_svg(local_cs, WITNESS_X, witness_y)
    print(f"\nplot written to {SVG_PATH}")
    print(f"certificate written to {CERTIFICATE_PATH}")


if __name__ == "__main__":
    main()
