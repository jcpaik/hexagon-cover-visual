#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
from dataclasses import asdict, dataclass
from decimal import Decimal, getcontext
from pathlib import Path
from typing import Any


getcontext().prec = 160

STRICT_TOL = Decimal("1e-80")
BRACKET_SAMPLES = 512
BINARY_SEARCH_STEPS = 220
SQRT3 = math.sqrt(3)
ANGLE_PERIOD = 2 * math.pi / 3
SEARCH_GRID = 6000
SEARCH_ITERS = 120
SVG_PATH = Path("counterexample_cover.svg")
JSON_PATH = Path("counterexample_cover.json")
DEFAULT_SNAPSHOT_PATH = Path("counterexample_snapshot.json")

COLORS = [
    "#0ea5e9",
    "#ef4444",
    "#f59e0b",
    "#10b981",
    "#8b5cf6",
    "#ec4899",
    "#14b8a6",
]


@dataclass(frozen=True)
class Point:
    x: float
    y: float


@dataclass(frozen=True)
class TriangleState:
    position: Point
    angle: float


@dataclass(frozen=True)
class CoverSnapshot:
    start_value: Decimal
    triangle_state: TriangleState
    strict_eps: Decimal
    raw: dict[str, Any]


@dataclass(frozen=True)
class StepData:
    a: Decimal
    b: Decimal
    c: Decimal
    a_next: Decimal


@dataclass
class EquilateralTriangle:
    name: str
    color: str
    center: Point
    phi: float
    side: float
    vertices: list[Point]
    normals: list[Point]
    lambdas: list[float]


def D(value: Decimal | float | str) -> Decimal:
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(repr(value))
    return Decimal(value)


def clamp01_decimal(value: Decimal) -> Decimal:
    return max(Decimal(0), min(Decimal(1), value))


def clamp01_float(value: float) -> float:
    return max(0.0, min(1.0, value))


def decimal_sqrt(value: Decimal) -> Decimal:
    if value <= 0:
        return Decimal(0)
    return value.sqrt()


def point_add(a: Point, b: Point) -> Point:
    return Point(a.x + b.x, a.y + b.y)


def point_sub(a: Point, b: Point) -> Point:
    return Point(a.x - b.x, a.y - b.y)


def point_scale(scale: float, point: Point) -> Point:
    return Point(scale * point.x, scale * point.y)


def dot(a: Point, b: Point) -> float:
    return a.x * b.x + a.y * b.y


def cross(a: Point, b: Point) -> float:
    return a.x * b.y - a.y * b.x


def triangle_vertices_from_center(center: Point, phi: float, side: float) -> list[Point]:
    circumradius = side / SQRT3
    return [
        Point(
            center.x + circumradius * math.cos(phi + 2 * math.pi * k / 3),
            center.y + circumradius * math.sin(phi + 2 * math.pi * k / 3),
        )
        for k in range(3)
    ]


def triangle_halfplanes(center: Point, phi: float, side: float) -> tuple[list[Point], list[float]]:
    inradius = side / (2 * SQRT3)
    normals = [
        Point(
            -math.cos(phi + 2 * math.pi * k / 3),
            -math.sin(phi + 2 * math.pi * k / 3),
        )
        for k in range(3)
    ]
    lambdas = [dot(normal, center) + inradius for normal in normals]
    return normals, lambdas


def build_triangle(name: str, center: Point, phi: float, side: float, color: str) -> EquilateralTriangle:
    vertices = triangle_vertices_from_center(center, phi, side)
    normals, lambdas = triangle_halfplanes(center, phi, side)
    return EquilateralTriangle(
        name=name,
        color=color,
        center=center,
        phi=phi,
        side=side,
        vertices=vertices,
        normals=normals,
        lambdas=lambdas,
    )


def hexagon_vertices() -> list[Point]:
    return [Point(math.cos(i * math.pi / 3), math.sin(i * math.pi / 3)) for i in range(6)]


def ordered_admissible(a: Decimal, b: Decimal, c: Decimal, strict_eps: Decimal) -> bool:
    sum_ab = a + b
    circle = a * a + a * b + b * b
    if circle > Decimal(1) - strict_eps + STRICT_TOL:
        return False

    transition = sum_ab**4 - sum_ab * sum_ab + a * b
    cell1 = (
        sum_ab <= Decimal(1) - strict_eps + STRICT_TOL
        and transition <= -strict_eps + STRICT_TOL
        and c**4 - c * c + a * c - a * a <= -strict_eps + STRICT_TOL
    )
    cell2 = (
        sum_ab <= Decimal(1) - strict_eps + STRICT_TOL
        and transition >= strict_eps - STRICT_TOL
        and (sum_ab * sum_ab - Decimal(1)) * c * c + b * c - b * b <= -strict_eps + STRICT_TOL
    )
    cell3 = (
        sum_ab >= Decimal(1) + strict_eps - STRICT_TOL
        and c <= Decimal("0.5") - strict_eps + STRICT_TOL
        and (a * a - Decimal(1)) * c * c
        + (Decimal(2) * a * b * b + b) * c
        + (b**4 - b * b)
        <= -strict_eps + STRICT_TOL
    )
    return cell1 or cell2 or cell3


def admissible(a_input: Decimal, b_input: Decimal, c_input: Decimal, strict_eps: Decimal) -> bool:
    a = clamp01_decimal(a_input)
    b = clamp01_decimal(b_input)
    c = clamp01_decimal(c_input)

    if a <= b + STRICT_TOL:
        if strict_eps > 0 and b - a < strict_eps - STRICT_TOL:
            return False
        return ordered_admissible(a, b, c, strict_eps)

    if strict_eps > 0 and a - b < strict_eps - STRICT_TOL:
        return False
    return ordered_admissible(b, a, c, strict_eps)


def circle_arc_bound(a_input: Decimal) -> Decimal:
    a = clamp01_decimal(a_input)
    disc = max(Decimal(0), Decimal(4) - Decimal(3) * a * a)
    return clamp01_decimal((-a + decimal_sqrt(disc)) / Decimal(2))


def max_coverage_bracket(a_input: Decimal, c_input: Decimal, strict_eps: Decimal) -> tuple[Decimal, Decimal]:
    a = clamp01_decimal(a_input)
    c = clamp01_decimal(c_input)
    upper = circle_arc_bound(a)

    if upper <= STRICT_TOL:
        return Decimal(0), Decimal(0)

    if admissible(a, upper, c, strict_eps):
        return upper, upper

    step = upper / Decimal(BRACKET_SAMPLES)
    lo = Decimal("-1")
    hi = upper

    for i in range(BRACKET_SAMPLES - 1, -1, -1):
        b = step * Decimal(i)
        if admissible(a, b, c, strict_eps):
            lo = b
            hi = min(upper, b + step)
            break

    if lo < 0:
        return Decimal(0), hi

    for _ in range(BINARY_SEARCH_STEPS):
        mid = (lo + hi) / Decimal(2)
        if admissible(a, mid, c, strict_eps):
            lo = mid
        else:
            hi = mid

    return lo, hi


def load_snapshot(path: Path | None) -> CoverSnapshot:
    source_path = DEFAULT_SNAPSHOT_PATH if path is None else path
    raw = json.loads(source_path.read_text(encoding="utf-8"))
    triangle_state = TriangleState(
        position=Point(
            float(raw["triangleState"]["position"]["x"]),
            float(raw["triangleState"]["position"]["y"]),
        ),
        angle=float(raw["triangleState"]["angle"]),
    )
    strict_eps = D(raw["strictEps"]) if raw.get("strictCheckEnabled", False) else Decimal(0)
    return CoverSnapshot(
        start_value=D(raw["startValue"]),
        triangle_state=triangle_state,
        strict_eps=strict_eps,
        raw=raw,
    )


def unit_snapshot_triangle_vertices(state: TriangleState) -> list[Point]:
    return triangle_vertices_from_center(state.position, state.angle + math.pi / 2, 1.0)


def ray_segment_intersection_distance(origin: Point, direction: Point, a: Point, b: Point) -> float | None:
    direction_length = math.hypot(direction.x, direction.y)
    if direction_length == 0:
        return None

    unit_direction = Point(direction.x / direction_length, direction.y / direction_length)
    edge = point_sub(b, a)
    offset = point_sub(a, origin)
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


def derive_gammas(state: TriangleState) -> list[Decimal]:
    origin = Point(0.0, 0.0)
    polygon = unit_snapshot_triangle_vertices(state)
    gammas: list[Decimal] = []
    for ray in hexagon_vertices():
        gamma = ray_polygon_exit_distance(origin, ray, polygon) or 0.0
        gammas.append(D(gamma))
    return gammas


def derive_search_local_cs(gammas: list[Decimal], strict_eps: Decimal) -> list[Decimal]:
    return [clamp01_decimal(Decimal(1) + strict_eps - gamma) for gamma in gammas]


def build_cover_steps(local_cs: list[Decimal], start_value: Decimal, strict_eps: Decimal) -> tuple[list[StepData], Decimal]:
    current = clamp01_decimal(start_value)
    steps: list[StepData] = []

    for c_value in local_cs:
        b_value, _ = max_coverage_bracket(current, c_value, strict_eps)
        next_value = clamp01_decimal(Decimal(1) + strict_eps - b_value)
        steps.append(StepData(a=current, b=b_value, c=c_value, a_next=next_value))
        current = next_value

    return steps, current


def local_points(index: int, step: StepData, hexagon: list[Point]) -> list[Point]:
    vertex = hexagon[index]
    previous = hexagon[(index - 1) % 6]
    next_vertex = hexagon[(index + 1) % 6]
    a = float(step.a)
    b = float(step.b)
    c = float(step.c)
    return [
        vertex,
        point_add(vertex, point_scale(a, point_sub(previous, vertex))),
        point_add(vertex, point_scale(b, point_sub(next_vertex, vertex))),
        point_scale(1 - c, vertex),
    ]


def required_inradius(points: list[Point], beta: float) -> float:
    normals = [
        Point(math.cos(beta + 2 * math.pi * k / 3), math.sin(beta + 2 * math.pi * k / 3))
        for k in range(3)
    ]
    offsets = [max(dot(normal, point) for point in points) for normal in normals]
    return sum(offsets) / 3


def centroid_from_beta(points: list[Point], beta: float) -> tuple[Point, float]:
    normals = [
        Point(math.cos(beta + 2 * math.pi * k / 3), math.sin(beta + 2 * math.pi * k / 3))
        for k in range(3)
    ]
    offsets = [max(dot(normal, point) for point in points) for normal in normals]
    radius = sum(offsets) / 3

    a1, b1 = normals[0].x, normals[0].y
    a2, b2 = normals[1].x, normals[1].y
    c1 = offsets[0] - radius
    c2 = offsets[1] - radius
    det = a1 * b2 - a2 * b1
    center = Point(
        (c1 * b2 - c2 * b1) / det,
        (a1 * c2 - a2 * c1) / det,
    )
    return center, radius


def golden_section(points: list[Point], left: float, right: float) -> tuple[float, float]:
    ratio = (math.sqrt(5) - 1) / 2
    x1 = right - ratio * (right - left)
    x2 = left + ratio * (right - left)
    f1 = required_inradius(points, x1 % ANGLE_PERIOD)
    f2 = required_inradius(points, x2 % ANGLE_PERIOD)

    for _ in range(SEARCH_ITERS):
        if f1 > f2:
            left = x1
            x1 = x2
            f1 = f2
            x2 = left + ratio * (right - left)
            f2 = required_inradius(points, x2 % ANGLE_PERIOD)
        else:
            right = x2
            x2 = x1
            f2 = f1
            x1 = right - ratio * (right - left)
            f1 = required_inradius(points, x1 % ANGLE_PERIOD)

    angle = (left + right) / 2
    return angle % ANGLE_PERIOD, required_inradius(points, angle % ANGLE_PERIOD)


def fit_triangle(name: str, points: list[Point], color: str) -> EquilateralTriangle:
    grid_step = ANGLE_PERIOD / SEARCH_GRID
    samples = [required_inradius(points, grid_step * i) for i in range(SEARCH_GRID)]
    best_index = min(range(SEARCH_GRID), key=lambda i: samples[i])
    candidates: list[tuple[float, float]] = []

    for shift in range(-2, 3):
        left = (best_index + shift - 1) * grid_step
        right = (best_index + shift + 1) * grid_step
        candidates.append(golden_section(points, left, right))

    beta, radius = min(candidates, key=lambda item: item[1])
    phi = beta + math.pi
    center, _ = centroid_from_beta(points, beta)
    side = 2 * SQRT3 * radius
    return build_triangle(name, center, phi, side, color)


def interval_on_segment(start: Point, end: Point, triangle: EquilateralTriangle) -> tuple[float, float] | None:
    t_min = 0.0
    t_max = 1.0
    direction = point_sub(end, start)
    eps = 1e-12

    for normal, lam in zip(triangle.normals, triangle.lambdas):
        constant = dot(normal, start) - lam
        delta = dot(normal, direction)
        if abs(delta) < eps:
            if constant <= eps:
                continue
            return None

        root = -constant / delta
        if delta > 0:
            t_max = min(t_max, root)
        else:
            t_min = max(t_min, root)

        if t_min > t_max + eps:
            return None

    return max(0.0, t_min), min(1.0, t_max)


def merge_intervals(intervals: list[tuple[float, float] | None]) -> list[tuple[float, float]]:
    valid = sorted(interval for interval in intervals if interval is not None and interval[1] >= interval[0])
    merged: list[list[float]] = []

    for start, end in valid:
        if not merged or start > merged[-1][1] + 1e-9:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)

    return [(start, end) for start, end in merged]


def format_intervals(intervals: list[tuple[float, float]]) -> str:
    return " ".join(f"[{start:.6f}, {end:.6f}]" for start, end in intervals)


def optimize_c_triangle(v_triangles: list[EquilateralTriangle], hexagon: list[Point]) -> tuple[EquilateralTriangle, list[float]]:
    origin = Point(0.0, 0.0)
    starts: list[float] = []
    for index, vertex in enumerate(hexagon):
        interval = interval_on_segment(origin, vertex, v_triangles[index])
        if interval is None:
            raise RuntimeError(f"{v_triangles[index].name} does not meet diagonal {index}.")
        starts.append(interval[0])

    support_points = [origin] + [point_scale(starts[i], hexagon[i]) for i in range(6)]
    return fit_triangle("C", support_points, COLORS[0]), starts


def verify_cover(c_triangle: EquilateralTriangle, v_triangles: list[EquilateralTriangle]) -> tuple[bool, list[str]]:
    hexagon = hexagon_vertices()
    origin = Point(0.0, 0.0)
    all_triangles = [c_triangle, *v_triangles]
    report: list[str] = []
    ok = True

    for i in range(6):
        edge_cover = merge_intervals(
            [
                interval_on_segment(hexagon[i], hexagon[(i + 1) % 6], triangle)
                for triangle in all_triangles
            ]
        )
        report.append(f"edge {i}: {format_intervals(edge_cover)}")
        if len(edge_cover) != 1 or edge_cover[0][0] > 1e-9 or edge_cover[0][1] < 1 - 1e-9:
            ok = False

    for i in range(6):
        diagonal_cover = merge_intervals(
            [
                interval_on_segment(origin, hexagon[i], triangle)
                for triangle in all_triangles
            ]
        )
        report.append(f"diag {i}: {format_intervals(diagonal_cover)}")
        if len(diagonal_cover) != 1 or diagonal_cover[0][0] > 1e-9 or diagonal_cover[0][1] < 1 - 1e-9:
            ok = False

    return ok, report


def svg_point(point: Point, min_x: float, max_y: float, scale: float, pad: float) -> tuple[float, float]:
    return pad + scale * (point.x - min_x), pad + scale * (max_y - point.y)


def export_svg(
    snapshot: CoverSnapshot,
    gammas: list[Decimal],
    steps: list[StepData],
    final_value: Decimal,
    c_triangle: EquilateralTriangle,
    v_triangles: list[EquilateralTriangle],
    c_diagonal_starts: list[float],
    coverage_report: list[str],
) -> None:
    all_points = hexagon_vertices() + [point for triangle in [c_triangle, *v_triangles] for point in triangle.vertices]
    min_x = min(point.x for point in all_points) - 0.25
    max_x = max(point.x for point in all_points) + 0.25
    min_y = min(point.y for point in all_points) - 0.25
    max_y = max(point.y for point in all_points) + 0.25

    plot_width = 760
    plot_height = 760
    info_width = 520
    pad = 30.0
    scale = min(plot_width / (max_x - min_x), plot_height / (max_y - min_y))
    width = int(plot_width + info_width + 3 * pad)
    height = int(plot_height + 2 * pad)

    hexagon = hexagon_vertices()
    diagonals = [(hexagon[0], hexagon[3]), (hexagon[1], hexagon[4]), (hexagon[2], hexagon[5])]
    triangles = [c_triangle, *v_triangles]

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        "<style>",
        "text { font-family: monospace; fill: #0f172a; }",
        ".title { font-size: 18px; font-weight: 700; }",
        ".body { font-size: 12px; }",
        ".label { font-size: 13px; font-weight: 700; }",
        "</style>",
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
        f'<text x="{pad:.1f}" y="22" class="title">Seven closed equilateral triangles with side &lt; 1 covering the hexagon skeleton</text>',
        f'<text x="{pad:.1f}" y="42" class="body">start x = {snapshot.start_value}, strictEps = {snapshot.strict_eps}, G(x) = {final_value}, G(x) - x = {final_value - snapshot.start_value}</text>',
    ]

    for triangle in triangles:
        vertices = [svg_point(point, min_x, max_y, scale, pad) for point in triangle.vertices]
        points_attr = " ".join(f"{x:.3f},{y:.3f}" for x, y in vertices)
        lines.append(
            f'<polygon points="{points_attr}" fill="{triangle.color}" fill-opacity="0.16" stroke="{triangle.color}" stroke-width="2"/>'
        )
        label_x, label_y = svg_point(triangle.center, min_x, max_y, scale, pad)
        lines.append(f'<text x="{label_x + 6:.3f}" y="{label_y - 6:.3f}" class="label">{triangle.name}</text>')

    hexagon_points = [svg_point(point, min_x, max_y, scale, pad) for point in hexagon]
    lines.append(
        '<polygon points="{}" fill="none" stroke="#111827" stroke-width="2"/>'.format(
            " ".join(f"{x:.3f},{y:.3f}" for x, y in hexagon_points)
        )
    )
    for start, end in diagonals:
        x1, y1 = svg_point(start, min_x, max_y, scale, pad)
        x2, y2 = svg_point(end, min_x, max_y, scale, pad)
        lines.append(f'<line x1="{x1:.3f}" y1="{y1:.3f}" x2="{x2:.3f}" y2="{y2:.3f}" stroke="#111827" stroke-width="1.5"/>')

    panel_x = plot_width + 2 * pad
    y = 72
    lines.append(f'<text x="{panel_x:.1f}" y="{y}" class="label">Triangle side lengths</text>')
    y += 20
    for triangle in triangles:
        lines.append(
            f'<text x="{panel_x:.1f}" y="{y}" class="body">{triangle.name}: side={triangle.side:.12f}  center=({triangle.center.x:.9f}, {triangle.center.y:.9f})  phi={triangle.phi:.9f}</text>'
        )
        y += 16

    y += 12
    lines.append(f'<text x="{panel_x:.1f}" y="{y}" class="label">Cycle data</text>')
    y += 20
    for index, (gamma, start, step) in enumerate(zip(gammas, c_diagonal_starts, steps)):
        lines.append(
            f'<text x="{panel_x:.1f}" y="{y}" class="body">V{index}: gamma={gamma:.9f}  a={step.a:.9f}  b={step.b:.9f}  c={step.c:.9f}  diag-start={start:.9f}</text>'
        )
        y += 16

    y += 12
    lines.append(f'<text x="{panel_x:.1f}" y="{y}" class="label">Coverage check</text>')
    y += 20
    for entry in coverage_report:
        lines.append(f'<text x="{panel_x:.1f}" y="{y}" class="body">{entry}</text>')
        y += 16

    lines.append("</svg>")
    SVG_PATH.write_text("\n".join(lines), encoding="utf-8")


def export_json(
    snapshot: CoverSnapshot,
    gammas: list[Decimal],
    steps: list[StepData],
    final_value: Decimal,
    c_triangle: EquilateralTriangle,
    v_triangles: list[EquilateralTriangle],
    c_diagonal_starts: list[float],
) -> None:
    triangles = [c_triangle, *v_triangles]
    data = {
        "snapshot": snapshot.raw,
        "gammas": [format(value, "f") for value in gammas],
        "finalValue": format(final_value, "f"),
        "cDiagonalStarts": c_diagonal_starts,
        "steps": [
            {
                "index": index,
                "a": format(step.a, "f"),
                "b": format(step.b, "f"),
                "c": format(step.c, "f"),
                "aNext": format(step.a_next, "f"),
            }
            for index, step in enumerate(steps)
        ],
        "triangles": [
            {
                "name": triangle.name,
                "color": triangle.color,
                "side": triangle.side,
                "center": asdict(triangle.center),
                "phi": triangle.phi,
                "vertices": [asdict(vertex) for vertex in triangle.vertices],
            }
            for triangle in triangles
        ],
    }
    JSON_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def main() -> None:
    snapshot_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    snapshot = load_snapshot(snapshot_path)
    gammas = derive_gammas(snapshot.triangle_state)
    local_cs = derive_search_local_cs(gammas, snapshot.strict_eps)
    steps, final_value = build_cover_steps(local_cs, snapshot.start_value, snapshot.strict_eps)

    hexagon = hexagon_vertices()
    v_triangles = [
        fit_triangle(f"V{i}", local_points(i, step, hexagon), COLORS[i + 1])
        for i, step in enumerate(steps)
    ]
    c_triangle, c_diagonal_starts = optimize_c_triangle(v_triangles, hexagon)

    cover_ok, coverage_report = verify_cover(c_triangle, v_triangles)
    if not cover_ok:
        raise RuntimeError("Computed triangles do not cover the skeleton.")

    if any(triangle.side >= 1 for triangle in [c_triangle, *v_triangles]):
        raise RuntimeError("At least one optimized triangle has side length >= 1.")

    export_svg(snapshot, gammas, steps, final_value, c_triangle, v_triangles, c_diagonal_starts, coverage_report)
    export_json(snapshot, gammas, steps, final_value, c_triangle, v_triangles, c_diagonal_starts)

    print(f"start x = {snapshot.start_value}")
    print(f"G(x) = {final_value}")
    print(f"G(x) - x = {final_value - snapshot.start_value}")
    for triangle in [c_triangle, *v_triangles]:
        print(
            f"{triangle.name}: side={triangle.side:.12f}, "
            f"center=({triangle.center.x:.12f}, {triangle.center.y:.12f}), "
            f"phi={triangle.phi:.12f}"
        )
    print(f"SVG written to {SVG_PATH}")
    print(f"JSON written to {JSON_PATH}")


if __name__ == "__main__":
    main()
