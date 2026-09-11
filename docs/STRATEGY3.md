# Strategy 3 Constructions

The three modes implement the paper's BC, D, and F witness sets. Geometry is
normalized to the unit hexagon with $V_i=(\cos(i\pi/3),\sin(i\pi/3))$,
$O=0$, $M_i=V_i/2$, and $X_i(t)=(1-t)V_i+tV_{i+1}$.
References below are pinned to database revision `a98c71c`.

Each mode draws labeled witnesses, their selected convex hull, and a numerical
minimum enclosing equilateral triangle. The point checkboxes change the fit;
a subset result is labeled separately from the complete construction.
Numerical condition checks use floating-point tolerances. The linked paper
supplies the proofs.

## BC: six-point selected gap

The normalized set is
$$
K_{BC}=\{M_0,X_0(\ell),X_0(r),d_2V_2,d_3V_3,d_4V_4\}.
$$

In **Parameters**, edit the two gap endpoints and three radial distances.
The default is $\ell=.5,r=.65,d_2=d_3=d_4=.5$. These are supplied witness
coordinates: the parameter view does not establish the triangle hypotheses.

In **V triangles**, translate or rotate each unit V triangle. Actual boundary
reaches give $\ell=B_0,r=1-A_1$. The radial coordinate is
$d_i=1-\max(C_i,u_{i-1\to i},u_{i+1\to i})$, where each neighboring term
is its innermost endpoint on that ray, measured from $V_i$ toward $O$.
Absent positive traces contribute zero.

The enclosure conditions are the selected gap $B_0+A_1\le1$,
$A_i+B_i\le1$ for $i=1,\ldots,5$, strict middle overlaps
$B_i+A_{i+1}>1$ for $i=1,\ldots,4$, and $B_5\ge B_0/2$.
Singleton gaps are permitted. The other incident edge may also have a gap.
The origin lies in the witness hull; no additional origin point or disk is
needed. See the [BC theorem and construction][bc-d].

## D: four-point rescuer

With $Y(t)=(1-t)V_0+tV_5$, the set is
$$
K_D=\{O,\varepsilon V_1,Y(a),Y(1-\beta)\}.
$$

**Parameters** starts at $(a,\varepsilon,\beta)=(.2,.4,.5)$. The geometric
theorem requires $\varepsilon>0$, $a\ge0$, $a+\varepsilon\le1$,
$a\le\varepsilon$, and $0\le\beta\le\varepsilon/(a+\varepsilon)$.
Endpoint values $a=0$ and $\beta=0$ remain valid.

**V triangles** derives $a=A_0$, $\beta=B_5$, and $\varepsilon=1-u$
from the actual supported interval $[c,u]$ of $T_0$ on $[V_1,O]$.
It checks midpoint supply and displays the covering-adapter conditions
separately from the three-parameter geometric theorem. Both gap ranks use
this same four-point set; no disk is used. See the [D theorem and adapter][bc-d].

BC and D retain separate parameter and triangle states. Switching input
source does not solve for triangle poses from arbitrary point coordinates.
Each triangle editor starts with Free's default V poses; case conditions
may initially be unmet. Witnesses remain visible when defined, with specific
condition failures shown. A missing required point makes its fit unavailable.

## F: nine-point Core

This mode replaces Core `f(a,b)`. Its strict domain is
$$
0<a,b<1,\qquad a+b>1,\qquad a^2+ab+b^2<1.
$$
The default is $(a,b)=(.55,.58)$. The nine points are
$$
K_F=\{(1-c_*)V_i:0\le i\le5\}\cup\{Q_-,Q_0,Q_+\},
\qquad c_*=c_{\max}(1-b,1-a).
$$
The frontier witnesses use the [analytic first-root formulas][f-formulas]
on the supercritical row at $V_4$. They have fixed definitions, so the former
graph's relaxed-P and two-line options do not apply. The separate Core Case
mode retains its original options.

The surface and heatmap display the numerical enclosing side length of the
selected points. The pink minimum curve is recomputed from the nine-point
samples. Sampling near $T(p,q)=(p+q)^4-(p+q)^2+pq=0$, with $p=1-b,q=1-a$,
uses a reference curve, without assuming it minimizes the new surface.
The disk toggle shows radius $(\sqrt3/2)(1-c_*)$ inside the full radial
hexagon; it is a comparison overlay, not an additional selected point.
The [nine-point theorem][f-theorem] closes the zero-gap branch with exactly
one supercritical actual row.

## Saving and loading

Controller snapshots use version 10. They include each BC/D source, parameter
values, V poses, and point selection, plus F's $(a,b)$, slice, sampling,
point selection, and disk visibility. Free snapshots retain their own version.

Controller versions 8 and 9 still load. Old Core graph snapshots migrate to
F: $P_3,P_4,P_5$ selections map to $Q_-,Q_0,Q_+$, existing $D_0,D_1,D_2$
selections are retained, and $D_3,D_4,D_5$ start enabled. The old snapshots
did not store $(a,b)$ or the slice, so those start at the new defaults.
Obsolete graph construction flags are discarded, and loading reports the
migration. Core Case fields preserve their existing behavior.

[bc-d]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/arrange/paper_draft/fixed_witness/06_fixed_witness_body.tex
[f-formulas]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/3XXX_CE0/31XX_Nplus1/310X_all_Vd0/3105X_self_contained_direct_Vd0_nine_point/31053_direct_asymmetric_witness_forcing.md
[f-theorem]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/3XXX_CE0/31XX_Nplus1/310X_all_Vd0/3105X_self_contained_direct_Vd0_nine_point/31058_center_independent_direct_nine_point_obstruction.md
