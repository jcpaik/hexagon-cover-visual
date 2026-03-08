#!/usr/bin/env python3
from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

from verify_counterexample import SNAPSHOT_STATE, STRICT_TOL, derive_local_cs, max_coverage_bracket


START_VALUE = Decimal("0.9173668553244948")
SQRT3 = math.sqrt(3)
CIRCUMRADIUS = 1 / SQRT3
INRADIUS = 1 / (2 * SQRT3)
ANGLE_PERIOD = 2 * math.pi / 3
SEARCH_GRID = 6000
SEARCH_ITERS = 120
SVG_PATH = Path("covering_triangles.svg")
MATHEMATICA_PATH = Path("covering_graphics.wl")

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
class StepData:
    a: Decimal
    b: Decimal
    c: Decimal
    a_next: Decimal


@dataclass
class EquilateralTriangle:
    name: str
    center: Point
    phi: float
    color: str
    vertices: list[Point]
    normals: list[Point]
    lambdas: list[float]
    min_side: float


def hexagon_vertices() -> list[Point]:
    return [Point(math.cos(i * math.pi / 3), math.sin(i * math.pi / 3)) for i in range(6)]


def point_add(a: Point, b: Point) -> Point:
    return Point(a.x + b.x, a.y + b.y)


def point_sub(a: Point, b: Point) -> Point:
    return Point(a.x - b.x, a.y - b.y)


def point_scale(scale: float, point: Point) -> Point:
    return Point(scale * point.x, scale * point.y)


def dot(a: Point, b: Point) -> float:
    return a.x * b.x + a.y * b.y


def triangle_vertices_from_center(center: Point, phi: float) -> list[Point]:
    return [
        Point(
            center.x + CIRCUMRADIUS * math.cos(phi + 2 * math.pi * k / 3),
            center.y + CIRCUMRADIUS * math.sin(phi + 2 * math.pi * k / 3),
        )
        for k in range(3)
    ]


def triangle_halfplanes(center: Point, phi: float) -> tuple[list[Point], list[float]]:
    normals = [
        Point(
            -math.cos(phi + 2 * math.pi * k / 3),
            -math.sin(phi + 2 * math.pi * k / 3),
        )
        for k in range(3)
    ]
    lambdas = [dot(normal, center) + INRADIUS for normal in normals]
    return normals, lambdas


def build_triangle(name: str, center: Point, phi: float, color: str, min_side: float) -> EquilateralTriangle:
    vertices = triangle_vertices_from_center(center, phi)
    normals, lambdas = triangle_halfplanes(center, phi)
    return EquilateralTriangle(
        name=name,
        center=center,
        phi=phi,
        color=color,
        vertices=vertices,
        normals=normals,
        lambdas=lambdas,
        min_side=min_side,
    )


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


def fit_local_triangle(name: str, points: list[Point], color: str) -> EquilateralTriangle:
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
    min_side = 2 * SQRT3 * radius
    return build_triangle(name, center, phi, color, min_side)


def build_cover_steps(local_cs: list[Decimal], start_value: Decimal) -> tuple[list[StepData], Decimal]:
    current = start_value
    steps: list[StepData] = []

    for c_value in local_cs:
        b_value, _ = max_coverage_bracket(current, c_value, STRICT_TOL)
        next_value = Decimal(1) - b_value
        steps.append(StepData(a=current, b=b_value, c=c_value, a_next=next_value))
        current = next_value

    return steps, current


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


def verify_cover(c_triangle: EquilateralTriangle, v_triangles: list[EquilateralTriangle]) -> tuple[bool, list[str]]:
    hexagon = hexagon_vertices()
    origin = Point(0.0, 0.0)
    report: list[str] = []
    ok = True

    for i in range(6):
        edge_cover = merge_intervals(
            [
                interval_on_segment(hexagon[i], hexagon[(i + 1) % 6], v_triangles[i]),
                interval_on_segment(hexagon[i], hexagon[(i + 1) % 6], v_triangles[(i + 1) % 6]),
                interval_on_segment(hexagon[i], hexagon[(i + 1) % 6], c_triangle),
            ]
        )
        report.append(f"edge {i}: {format_intervals(edge_cover)}")
        if len(edge_cover) != 1 or edge_cover[0][0] > 1e-9 or edge_cover[0][1] < 1 - 1e-9:
            ok = False

    for i in range(6):
        diagonal_cover = merge_intervals(
            [
                interval_on_segment(origin, hexagon[i], c_triangle),
                interval_on_segment(origin, hexagon[i], v_triangles[i]),
            ]
        )
        report.append(f"diag {i}: {format_intervals(diagonal_cover)}")
        if len(diagonal_cover) != 1 or diagonal_cover[0][0] > 1e-9 or diagonal_cover[0][1] < 1 - 1e-9:
            ok = False

    return ok, report


def svg_point(point: Point, min_x: float, max_y: float, scale: float, pad: float) -> tuple[float, float]:
    return pad + scale * (point.x - min_x), pad + scale * (max_y - point.y)


def export_svg(
    c_triangle: EquilateralTriangle,
    v_triangles: list[EquilateralTriangle],
    local_cs: list[Decimal],
    steps: list[StepData],
    final_value: Decimal,
    coverage_report: list[str],
) -> None:
    all_points = hexagon_vertices() + [point for triangle in [c_triangle, *v_triangles] for point in triangle.vertices]
    min_x = min(point.x for point in all_points) - 0.25
    max_x = max(point.x for point in all_points) + 0.25
    min_y = min(point.y for point in all_points) - 0.25
    max_y = max(point.y for point in all_points) + 0.25

    plot_width = 720
    plot_height = 720
    info_width = 420
    pad = 30.0
    scale = min(plot_width / (max_x - min_x), plot_height / (max_y - min_y))
    width = int(plot_width + info_width + 3 * pad)
    height = int(plot_height + 2 * pad)

    hexagon = hexagon_vertices()
    diagonals = [(hexagon[0], hexagon[3]), (hexagon[1], hexagon[4]), (hexagon[2], hexagon[5])]
    triangles = [c_triangle, *v_triangles]

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        '<style>',
        'text { font-family: monospace; fill: #0f172a; }',
        '.title { font-size: 18px; font-weight: 700; }',
        '.body { font-size: 12px; }',
        '.label { font-size: 13px; font-weight: 700; }',
        '</style>',
        f'<rect x="0" y="0" width="{width}" height="{height}" fill="#ffffff"/>',
        f'<text x="{pad:.1f}" y="22" class="title">Seven unit equilateral triangles covering the hexagon skeleton</text>',
        f'<text x="{pad:.1f}" y="42" class="body">Built from the snapshot C-triangle and start value x = {START_VALUE}</text>',
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
    lines.append(f'<text x="{panel_x:.1f}" y="72" class="label">Cycle data</text>')
    lines.append(f'<text x="{panel_x:.1f}" y="92" class="body">G(x) = {final_value}</text>')
    lines.append(f'<text x="{panel_x:.1f}" y="108" class="body">G(x) - x = {final_value - START_VALUE}</text>')

    y = 136
    for index, (c_value, step) in enumerate(zip(local_cs, steps)):
        lines.append(
            f'<text x="{panel_x:.1f}" y="{y}" class="body">V{index}: a={step.a:.6f}  b={step.b:.6f}  c={c_value:.6f}</text>'
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


def mathematica_triangle(triangle: EquilateralTriangle) -> str:
    return (
        f"Polygon[Table[{{{triangle.center.x:.16f}, {triangle.center.y:.16f}}} + "
        f"1/Sqrt[3] * {{Cos[{triangle.phi:.16f} + 2 Pi k/3], Sin[{triangle.phi:.16f} + 2 Pi k/3]}}, {{k, 0, 2}}]]"
    )


def export_mathematica(c_triangle: EquilateralTriangle, v_triangles: list[EquilateralTriangle]) -> None:
    hexagon = hexagon_vertices()
    hexagon_loop_points = ", ".join(
        f"{{{point.x:.16f}, {point.y:.16f}}}" for point in [*hexagon, hexagon[0]]
    )
    diagonals = [
        f"Line[{{{{{hexagon[0].x:.16f}, {hexagon[0].y:.16f}}}, {{{hexagon[3].x:.16f}, {hexagon[3].y:.16f}}}}}]",
        f"Line[{{{{{hexagon[1].x:.16f}, {hexagon[1].y:.16f}}}, {{{hexagon[4].x:.16f}, {hexagon[4].y:.16f}}}}}]",
        f"Line[{{{{{hexagon[2].x:.16f}, {hexagon[2].y:.16f}}}, {{{hexagon[5].x:.16f}, {hexagon[5].y:.16f}}}}}]",
    ]

    primitives = [
        f"{{Thickness[0.003], Black, Line[{{{hexagon_loop_points}}}], {', '.join(diagonals)}}}"
    ]

    for triangle in [c_triangle, *v_triangles]:
        rgb = tuple(int(triangle.color[i : i + 2], 16) / 255 for i in (1, 3, 5))
        primitives.append(
            f"{{FaceForm[Directive[Opacity[0.18], RGBColor[{rgb[0]:.6f}, {rgb[1]:.6f}, {rgb[2]:.6f}]]], "
            f"EdgeForm[Directive[RGBColor[{rgb[0]:.6f}, {rgb[1]:.6f}, {rgb[2]:.6f}], Thickness[0.003]]], "
            f"{mathematica_triangle(triangle)}}}"
        )
        primitives.append(
            f'Text[Style["{triangle.name}", 12, Bold, FontFamily -> "Courier"], {{{triangle.center.x:.16f}, {triangle.center.y:.16f}}}]'
        )

    all_points = hexagon + [point for triangle in [c_triangle, *v_triangles] for point in triangle.vertices]
    min_x = min(point.x for point in all_points) - 0.25
    max_x = max(point.x for point in all_points) + 0.25
    min_y = min(point.y for point in all_points) - 0.25
    max_y = max(point.y for point in all_points) + 0.25

    expression = (
        "Graphics[{\n  "
        + ",\n  ".join(primitives)
        + f"\n}}, PlotRange -> {{{{{min_x:.16f}, {max_x:.16f}}}, {{{min_y:.16f}, {max_y:.16f}}}}}, ImageSize -> 700]"
    )
    MATHEMATICA_PATH.write_text(expression + "\n", encoding="utf-8")


def main() -> None:
    local_cs = derive_local_cs(SNAPSHOT_STATE)
    steps, final_value = build_cover_steps(local_cs, START_VALUE)

    c_triangle = build_triangle(
        name="C",
        center=Point(SNAPSHOT_STATE.position.x, SNAPSHOT_STATE.position.y),
        phi=SNAPSHOT_STATE.angle + math.pi / 2,
        color=COLORS[0],
        min_side=1.0,
    )

    hexagon = hexagon_vertices()
    v_triangles = [
        fit_local_triangle(f"V{i}", local_points(i, step, hexagon), COLORS[i + 1])
        for i, step in enumerate(steps)
    ]

    for triangle in v_triangles:
        if triangle.min_side > 1 + 1e-9:
            raise RuntimeError(f"{triangle.name} needs side length {triangle.min_side}, not 1.")

    cover_ok, coverage_report = verify_cover(c_triangle, v_triangles)
    if not cover_ok:
        raise RuntimeError("Computed triangles do not cover the skeleton.")

    export_svg(c_triangle, v_triangles, local_cs, steps, final_value, coverage_report)
    export_mathematica(c_triangle, v_triangles)

    print(f"start x = {START_VALUE}")
    print(f"G(x) = {final_value}")
    print(f"G(x) - x = {final_value - START_VALUE}")
    for triangle in [c_triangle, *v_triangles]:
        print(
            f"{triangle.name}: center=({triangle.center.x:.12f}, {triangle.center.y:.12f}), "
            f"phi={triangle.phi:.12f}, min_side={triangle.min_side:.12f}"
        )
    print(f"SVG written to {SVG_PATH}")
    print(f"Mathematica graphics written to {MATHEMATICA_PATH}")


if __name__ == "__main__":
    main()
