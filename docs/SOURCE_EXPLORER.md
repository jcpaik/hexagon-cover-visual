# Witness arguments and source-family exploration

## Two views, two questions

Strategy 3 starts in **Witness argument**. It shows the fixed witnesses, their
hull, and an outline-only enclosing candidate. Source fills and outlines are
off. The proof question is whether these fixed points can lie in an open unit
C triangle. The displayed fit is not an actual C triangle from a covering.

**Source-family explorer** compares one V role with its endpoint conditions
relaxed versus fixed. Unit side, strict vertex containment, required interior
points, and actual reach-sum restrictions stay identical. Only the exact
endpoint equalities are relaxed. A role with no exact endpoint has identical
families in both panels. Use the role selector and Solo checkbox to avoid other
V regions concealing the difference. The ordinary `ab union` mode is unchanged.

Source fills, source outlines, witness hull, enclosing candidate, and candidate
fill have independent controls. Switching between the two views restores their
respective layer presets. These presentation settings are session-local, per
BC/D/F mode, and reset on snapshot restoration. Saved mathematical inputs,
point selections, region visibility, locks, and the version-11 schema are
unchanged. Presentation changes never move witnesses or change admissibility.

BC/D radial points in this app are **capacity-derived substitutes**, not
measurements of actual V triangles or the original supplier interval. The
header separates this provenance, numerically validated local source existence,
global covering hypotheses (not verified), and the enclosure calculation. Six
nonempty local families do not establish a jointly realizable cover. The D
geometric theorem, when its displayed inequalities hold, is distinct from
establishing the paper's actual-source covering adapter.

## Inspect a point and its source

Click either comparison panel, enter finite x/y coordinates and press Enter or
**Inspect point**, or enable inspection on the main canvas. Main-canvas
inspection replaces handle dragging while enabled. A click within four canvas
pixels of an edge is explicitly snapped to that edge and labeled with its edge
parameter; arbitrary nearby interior coordinates are not treated as edge points.

The two panels independently return:

- **Source found:** one triangle was constructed, revalidated against all family
  conditions, and checked for point containment. Its dashed outline, measured
  actual reaches A and B, their sum, and minimum required interior clearance are
  displayed. The point-containment tolerance is 2e-11; required interior points
  retain the source solver's 1e-9 side clearance.
- **Analytic obstruction:** an exact-trace, outside-hexagon, diameter, or
  supporting-line obstruction applies. The inequalities are evaluated in
  floating point, with explicit safety margins; they are not interval-certified
  proofs of borderline cases.
- **Unresolved:** no source was found at the sampled orientations and no
  implemented analytic obstruction applies. A missed search is not nonexistence.

Different points in a source-family union may need different triangles. Neither
shading nor a validated individual source proves global coverage.

The built-in **Interior-difference demo** is an isolated local comparison with
(a,b)=(3/4,1/8), a nonsupercritical source rule, and an exact forward endpoint.
It does not change live BC/D/F boundary handles or witness coordinates. At local
Q=(19/40,3/20), the relaxed family has a source, but the exact family needs side
at least (361-25 sqrt(3))/(40 sqrt(58)) = 1.04289717... . This demonstrates an
interior difference, not just deletion of boundary points.

## What the mask represents

At each sampled orientation the sampler enumerates **separate convex feasible
support-offset cells**. If T is a fixed-orientation unit triangle and P is a
convex polygon of allowed translations, then

    union_{t in P}(T+t) = T+P = conv(union_{v vertex of P}(T+v)).

For t=sum(alpha_j v_j), x+t=sum(alpha_j(x+v_j)), giving one inclusion. The other
follows from convexity of T+P. Thus the extreme translations determine the
entire same-cell union; arbitrary sampling of its interior offsets is no longer
necessary for the displayed fill.

`translationCells.ts` constructs this polygon separately for each orientation
and feasible cell. The exact-endpoint supporting-side choices and the
nonsupercritical halfspace alternatives must remain split: taking one hull
across those cells or across orientations can introduce invalid points. The
full same-cell polygon is formed before intersection with the hexagon.

The three support offsets have sum sqrt(3)/2, so varying them within this plane
translates a unit triangle without changing its orientation or size. A point
inside a cell polygon has a concrete source: intersect that same offset cell
with the three inequalities lambda_i >= n_i dot Q, select a feasible offset,
and reconstruct and revalidate the triangle. The inspector does this rather
than treating an arbitrary convex combination of triangles as a source.

Numerical extreme points that fail the independent source validator are
omitted; their remaining convex hull still lies in the same feasible cell in
real arithmetic. Roundoff-degenerate portions can therefore be missed. The
original validated samples and feasibility seed are retained as well. The
renderer takes the Boolean union of these individual polygons and samples at
pixel centers. It does not take an ordinary analytic envelope, a global hull,
or a planar cut through a gap endpoint. Fill and outline use the same mask.

The orientation grid remains finite: 60 preview or 240 full orientations over
120 degrees, supplemented by anchor and validated-source orientations. This is
not an exhaustive computation of the full infinite family. In each numerical
cell the continuous translations are represented, but orientation discretization,
positive containment margins, and numerical validation still limit completeness.
Unshaded pixels do not prove exclusion. Restricted cells/samples are included
in the relaxed comparison collection to preserve its inclusion at the sampled
level; an apparent sampled difference alone is not an analytic exclusion.

## Boundary gaps are a separate one-dimensional statement

For actual open V triangles the incident edge traces are [0,B_i) and
(1-A_{i+1},1]. If B_i <= 1-A_{i+1}, the closed gap between their endpoints is
missed by both. Nonincident V roles are excluded by the unit-diameter bound.
Under a hypothetical cover C must contain that gap. This argument uses actual
traces, not complements of sampled unions.

Exact gap bars use these endpoint constraints directly. The red annotation and
its white halo are drawn after filled overlays; the halo is not a deletion from
any geometric mask. A shared lower-demand handoff is not a singleton gap.

A fixed finite union of closed triangles is closed, and has positive distance
from a fixed excluded point. The finite collection of bounded numerical cell
polygons is also closed. Such distances can nevertheless be smaller than a
pixel. The full infinite trace-exact family with strict vertex containment need
not have a closed union and can accumulate at excluded edge points. Neither a
pixel square nor an outline stroke certifies exact edge membership.

## Exhaustive finite-point calipers

For a finite set W and outward normals n(theta+2j*pi/3), let

    L(theta) = (2/sqrt(3)) sum_j max_{p in W} p dot n(theta+2j*pi/3).

On an interval with fixed maximizing vertices this is A cos(theta)+B sin(theta)
and is positive for a non-singleton set. Hence L''=-L<0 and there is no interior
minimum. It suffices to enumerate outward normals to all convex-hull edges,
modulo 120 degrees. `fitTriangle` now does this instead of a grid followed by
local golden-section refinement. Duplicate, singleton, segment, collinear, and
nearly collinear inputs are supported; empty/nonfinite input is rejected.
Translation and scaling before the support calculation reduce cancellation.

This exhausts orientations mathematically; it does not make floating-point
comparison with side one a certified lower bound. A near-one result requires
separate exact/interval verification. Witnesses are fixed before fitting, and
capacity-derived witnesses can be easier to enclose than the actual frontier
set. Their numerical fits must not silently inherit stronger actual-source
hypotheses.

The support-cell argument is in the database's
`proof/2XXX_geometric_lemmas/26XX_enclosing_triangle_tools/2607_minimal_enclosing_equilateral_quadrilateral_lemma.md`.
The source-family definition is in
`proof/2XXX_geometric_lemmas/20XX_V_triangle_geometry/2009X_ab_set/2009e_trace_exact_ab_envelopes.md`.
No proof-database files are changed by this visualizer update.

## Supporting-line exclusion used by the inspector

Use local forward direction (1,0), backward direction (-1/2,h), h=sqrt(3)/2.
For an exact forward stop (b,0), an interior point Q=(x,y) with x>b and y>0
forces an active outward normal (1,-m)/sqrt(1+m^2), m >= (x-b)/y. Containing
Q and the backward anchor a(-1/2,h) in the other two support halfplanes gives

    h L >= (C + D m)/sqrt(1+m^2),
    C = b - x/2 + h*y - a/2,
    D = h*(x+a) + y/2.

The implementation uses only C<0, D>0. The derivative is
(D-C*m)/(1+m^2)^(3/2)>0, so substitution of m=(x-b)/y gives a valid lower bound.
Reflection treats an exact backward endpoint. The inspector asserts an
obstruction only when this evaluated bound exceeds 1+1e-8; outside this domain
it uses no extrapolation and may report unresolved.

## Verification

`npm run verify` includes `verify:calipers`, `verify:source-explorer`, and
`verify:sampled-render`, as well as the existing proof-geometry, snapshot,
source-feasibility, boundary, movement, and Strategy 3 regressions.

Calipers are compared with an independent ordered-point-pair orientation oracle
and a dense grid. Cell tests validate extremes and convex combinations, recover
individual sources, and check cell edge exclusions. Comparison tests cover the
strict interior counterexample, reflections, D's midpoint condition, relaxed
sample inclusion, and honest unresolved results. Rendering tests compare pixel
masks with independent polygon membership, including narrow/equality families,
invalid seeds, singleton gaps, and the reconstructed screenshot inputs.
