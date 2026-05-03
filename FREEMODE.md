# Free Mode

## Objects

Free mode represents seven open unit equilateral triangles:

\[
T_C,\ T_0,\ T_1,\dots,T_5.
\]

The triangle \(T_C\) is the center triangle.  Each \(T_i\) is the triangle
assigned to the hexagon vertex \(V_i\).

The regular hexagon has center

\[
O=(0,0)
\]

and vertices

\[
V_i=(\cos(i\pi/3),\sin(i\pi/3)).
\]

The midpoint of the half-diagonal \([O,V_i]\) is

\[
M_i=\frac12 V_i.
\]

## Targets

Free mode has two covering targets.

The full skeleton is

\[
S=\partial H\cup [O,V_0]\cup\cdots\cup[O,V_5].
\]

The half-skeleton target is

\[
S_{1/2}=\partial H\cup\{O,M_0,\dots,M_5\}.
\]

Thus \(S_{1/2}\) still includes the whole boundary \(\partial H\), but replaces
the six half-diagonal segments with seven marked points.

## Base Constraints

The following constraints are always active:

\[
O\in T_C,
\]

and

\[
V_i\in T_i,\qquad i=0,\dots,5.
\]

Additional midpoint constraints may be enabled in the control panel.

For \(T_C\), any subset of

\[
\{M_0,\dots,M_5\}
\]

may be required.

For \(T_i\), only the local midpoint candidates

\[
\{M_{i-1},M_i,M_{i+1}\}
\]

are exposed as constraints, with indices taken modulo \(6\).

## Edge-Through-Point Constraints

Each triangle may have at most one active edge-through-point constraint in the
current implementation.

An edge-through-point constraint has the form:

\[
\text{edge}_k(T)\ni P,
\]

where \(k\in\{0,1,2\}\), and \(P\) is a named point.

The canvas labels every visible triangle edge with the same index used by this
constraint:

\[
T:e0,\quad T:e1,\quad T:e2.
\]

For example, `V3:e1` is edge `1` of the triangle assigned to \(V_3\).  These
labels are part of the mathematical interface: choosing edge `1` in the control
panel means the edge labeled `V3:e1` in the figure.

Named points include:

- \(O\),
- the six \(M_i\),
- the six \(V_i\),
- dynamic labeled intersection points,
- static labeled intersection points,
- manual coordinate points in saved state.

Labeled points are created with either `d-mark` or `s-mark` by selecting two
finite line segments.  The allowed source segments are:

- hexagon boundary edges,
- half-diagonals \([O,V_i]\),
- visible triangle edges.

If the two selected segments intersect, `d-mark` creates a dynamic label
(`D1`, `D2`, ...) that stores both source segments and recomputes its coordinate
whenever the triangles move.  `s-mark` creates a static label (`S1`, `S2`, ...)
whose coordinate is fixed at creation time.  Static labels keep the same
`first` and `second` fields as dynamic labels, but only fixed source segments
(hexagon edges and half-diagonals) are recorded; triangle-edge sources are
stored as `null`.  If the selected segments do not intersect, no label is
created.

While a label is being created in either mark mode, selected source segments
are highlighted in the figure.  This highlight is temporary bookkeeping only;
it does not add a geometric constraint unless a labeled point is later used in
an edge-through-point constraint.

## Vd0 Raw Sources

For a \(V_i\)-triangle, Vd0 computes raw \(a,b,c\) from the farthest uncovered
point on the three incident skeleton branches by default.  Each raw coordinate
can instead use the current vertex \(V_i\), a marked label, or the relevant
midpoint \(M_i\), when that point lies on the coordinate branch.  The value is
measured as distance from \(V_i\) along the branch:

- \(a\) uses \([V_i,V_{i-1}]\),
- \(b\) uses \([V_i,V_{i+1}]\),
- \(c\) uses \([V_i,O]\).

If a selected raw source later becomes invalid or leaves the branch, Vd0 falls
back to the automatic farthest-uncovered value for that coordinate.

## Interface Conventions

Free mode is separate from the \(g_c\)-chain interface.  When Free mode is
active, the graph panel is hidden entirely:

- no map graph is displayed,
- the compose-chain buttons are hidden,
- the admissible-set editor is hidden,
- the ordinary controller-state panel is hidden.

The right panel instead shows only Free mode controls and the Free JSON state.

Moving a triangle is direct manipulation of its pose.  The app then projects the
candidate pose back toward the active constraints:

- \(T_C\) must continue to contain \(O\),
- \(T_i\) must continue to contain \(V_i\),
- checked midpoint constraints must remain satisfied,
- any active edge-through-point constraint must remain satisfied.

This projection is a numerical interaction rule.  It is not a separate theorem
about the covering problem.

## Open Triangle Semantics

The mathematical problem uses open triangles.  Free mode therefore uses a
strict epsilon model for validity.

A point \(p\) counts as covered by a triangle \(T\) only when it lies inside
all three triangle half-planes by at least \(\varepsilon\), where
\(\varepsilon\) is the free-mode strict epsilon.

Similarly, a skeleton segment is covered by a triangle only on the subinterval
that remains after applying the same epsilon margin.  The app computes interval
coverage on each skeleton segment, merges those intervals over all seven
triangles, and reports the remaining gaps.

This means a point lying exactly on a triangle edge is not treated as covered
for the strict validity test, even though it is visually on the boundary.

## Validity

For target \(S\), a free-mode configuration is valid when:

1. all active constraints are satisfied with the strict epsilon margin, and
2. every boundary edge and every half-diagonal has no uncovered interval.

For target \(S_{1/2}\), a free-mode configuration is valid when:

1. all active constraints are satisfied with the strict epsilon margin,
2. every boundary edge has no uncovered interval, and
3. \(O,M_0,\dots,M_5\) are each covered by at least one triangle.

Fixed triangles remain part of the covering test.  Hidden triangles also remain
part of the covering test; hiding only removes them from the canvas hit target
and visual clutter.  Hiding an unfixed triangle automatically fixes it.  If a
hidden triangle is unfixed, it is shown again.
