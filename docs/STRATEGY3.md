# Strategy 3 Constructions

The three modes visualize the paper's BC, D, and F witness constructions from
movable boundary inputs. Geometry is normalized to the unit hexagon with
$V_i=(\cos(i\pi/3),\sin(i\pi/3))$, $O=0$, $M_i=V_i/2$, and
$X_i(t)=(1-t)V_i+tV_{i+1}$. References are pinned to database revision
`a98c71c`.

## Boundary inputs

| Mode | Boundary handles | Gap edges | Derived witnesses |
| --- | --- | --- | --- |
| BC, seven dots (default) | 7 | 0 | 6 |
| BC, eight dots | 8 | 0 and 5 | 6 |
| D, seven dots (default) | 7 | 5 | 4 |
| D, eight dots | 8 | 0 and 5 | 4 |
| F | 6 | none | 9 |

Drag a handle along its edge or edit its numeric position. An edge has either
one shared handle or two ordered gap endpoints. Writing these positions as
$\ell_i\le r_i$, the inputs are $b_i=\ell_i$ and $a_i=1-r_{i-1}$, with indices
modulo six. Shared handles have $\ell_i=r_i$; a gap whose endpoints coincide
retains two handles. Each BC/D layout remembers its own positions.

Boundary handles are the sole coordinate inputs. Witness coordinates and
regions update from them; witnesses cannot be dragged independently. Point
checkboxes select witnesses for the displayed convex hull and numerical
minimum enclosing equilateral triangle. Subset fits are labeled separately.
Movement preserves the construction/case inequalities and an admissible source
triangle in each of the six restricted AB families. These checks always use
the full construction, even when regions or witnesses are hidden.

**Stop that dot** (default) holds all other dots fixed and limits the edited
position. **Adjust neighboring dots** propagates ordering, nonsupercritical
handoff, BC tail, and F common-pair corrections around the boundary. If the
result violates a source or construction constraint, the movement is shortened.
This is a local correction rule, not a global closest-configuration search.
Mouse, touch, and numeric edits use the same rules and report blocking limits.
Strict inequalities use a `1e-9` margin; blocked edits refine the accepted edge
position to `1e-6` precision.

## Restricted AB regions

The shaded regions are sampled unions of qualifying **source triangles**,
intersected with the assigned vertex's corner cone and the hexagon. Every
source is a closed unit equilateral triangle with its assigned vertex strictly
inside. Let $A_i(S),B_i(S)$ denote that triangle's actual backward and forward
boundary reaches.

- A shared handoff supplies lower demands: $A_i(S)\ge a_i$, $B_i(S)\ge b_i$.
- A gap's left endpoint requires its preceding source's forward reach to equal
  $b_i$ exactly.
- A gap's right endpoint requires its following source's backward reach to
  equal $a_i$ exactly.
- A source between two gaps must satisfy both exact reach restrictions.

These are the paper's [trace-exact AB source families][restricted]. Cutting an
ordinary AB union with a planar clipping line does not produce these families.
The ordinary AB Union mode retains its own interpretation; its “exact” region
option does not mean trace-exact endpoints.

Case filters also apply to actual source reaches. BC rows 1–5 must be
nonsupercritical. In D, row 1 is supercritical, the other rows are
nonsupercritical, and row 0 must supply $M_1$. In F, row 4 is supercritical and
the other rows are nonsupercritical. Here “supercritical” means
$A_i(S)+B_i(S)>1$. Lower demands $a_i+b_i$ alone do not determine actual reaches
or certify a covering arrangement.

Sampling uses fewer orientations and offset allocations while dragging, then
refines after release. A separate source solver constructs and validates a
unit triangle for each family. Rows without interior-point requirements use
explicit edge-endpoint constructions; D's midpoint supplier uses supporting
side constraints and analytically determined orientation intervals. Strict
vertex/midpoint containment has a `1e-9` margin.

Verified sources seed the shading, so a narrow family remains represented
even if the orientation sampler misses it. Sample counts do not determine
movement limits. The shading is illustrative and never supplies witness
coordinates. Source existence in each family does not certify a global
covering arrangement.

Strategy 3 reuses the AB Union rendering pipeline for these restricted region
masks. The six region checkboxes change drawing only; hiding a region leaves
its mask, analytic capacities, witness coordinates, and case checks unchanged.
Each mode remembers its own visibility choices, shared across that mode's
seven/eight-dot layouts. All regions are visible initially.

## Analytic witnesses

Own-ray capacities $c_{\max}$ and [neighboring-ray capacities $C_+,C_-$][neighbor]
provide conservative radial bounds. Set
$$
\Gamma_i=\max\bigl(c_{\max}(a_i,b_i),\,
C_+(a_{i-1},b_{i-1}),\,C_-(a_{i+1},b_{i+1})\bigr),
\qquad d_i=1-\Gamma_i.
$$
Include neighboring terms where defined; $C_-(a,b)=C_+(b,a)$. These ordinary
AB-family bounds remain safe for the restricted subfamilies. They may exceed
what the sampled restricted region reaches. The [finite-enclosure
principle][radial] explains the relationship between radial bounds and
residual witnesses.

### BC: six-point selected gap

The capacity-derived set is
$$
K_{BC}=\{M_0,X_0(\ell_0),X_0(r_0),d_2V_2,d_3V_3,d_4V_4\}.
$$

The gap and radial conditions are checked independently, and the enclosing
triangle is fit to these six coordinates. The paper's actual-source BC
construction uses measured total radial endpoints and covering hypotheses;
capacity-derived points are conservative replacements. A numerical fit or
successful sampled-family filter does not certify all of those hypotheses.
See the [BC theorem and construction][bc-d].

### D: four-point rescuer

With $Y(t)=(1-t)V_0+tV_5$, use $a=a_0$, $\beta=b_5$, and
$\varepsilon=1-\Gamma_1$ to form
$$
K_D=\{O,\varepsilon V_1,Y(a),Y(1-\beta)\}.
$$

The four-point geometric conditions are $\varepsilon>0$, $a\ge0$,
$a+\varepsilon\le1$, $a\le\varepsilon$, and
$0\le\beta\le\varepsilon/(a+\varepsilon)$. They are evaluated separately from
the source-family conditions. Both gap layouts use the same formula.

The bound $\Gamma_1$ includes all defined own and neighboring contributions.
It does not choose an actual supplier interval $[c,u]$. Consequently the
view does not claim to establish the paper's actual-source covering adapter.
See the [D theorem and adapter][bc-d].

### F: nine-point Core

The critical row gives $a=a_4=1-r_3$ and $b=b_4=\ell_4$. The strict formula
domain is
$$
0<a,b<1,\qquad a+b>1,\qquad a^2+ab+b^2<1.
$$
The initial boundary positions give $(a,b)=(.55,.58)$. The **Exact frontier**
selection retains the original nine points
$$
K_F=\{(1-c_*)V_i:0\le i\le5\}\cup\{Q_-,Q_0,Q_+\},
\qquad c_*=c_{\max}(1-b,1-a).
$$
The frontier witnesses use the [analytic first-root formulas][f-formulas].
They are not Newton approximations: $Q_-$ and $Q_+$ are first circle
intersections, while $Q_0=\Psi_4(J)$ is the common line junction.

New sessions default to **Newton inner A, B, C**. This selection replaces only
the last three points by the paper's [Newton inner witnesses][newton]:
$$
K_N=\{(1-c_*)V_i:0\le i\le5\}\cup\{A,B,C\},\qquad
A\in(Q_0,Q_-),\quad B=Q_0,\quad C\in(Q_0,Q_+).
$$
In the same corner chart, put $h=\sqrt3/2$, $\rho=a^2+ab+b^2$,
$D=\sqrt{4\rho-3}$, and $\lambda_*=\mu_*=8h\rho/(3(D+3))$.
With the unchanged frontier coefficients $\alpha,\beta,\gamma,\delta$, use
$$
g_-(x)=\tfrac34x^2-3(\alpha+b\beta)x+3b^2-3b+2,\qquad
g_+(x)=\tfrac34x^2-3(\delta+a\gamma)x+3a^2-3a+2.
$$
The implementation takes **exactly one** Newton step from the junction:
$$
\widehat\lambda=\lambda_*-\frac{g_-(\lambda_*)}{g_-'(\lambda_*)},\qquad
\widehat\mu=\mu_*-\frac{g_+(\mu_*)}{g_+'(\mu_*)},
$$
then sets $A=\Psi_4(b-\beta\widehat\lambda,\alpha\widehat\lambda)$ and
$C=\Psi_4(\delta\widehat\mu,a-\gamma\widehat\mu)$.
This is equivalent to the paper's rescaled step for $\widetilde g(x)=g(hx)$;
it is neither an iterative root solve nor a midpoint replacement.
The table and canvas label these points **A, B, C**, never $Q_-,Q_0,Q_+$.
Saved selection IDs remain `Q-`, `Q0`, `Q+` as stable slots; a disabled `Q-`
slot disables $A$ in Newton mode and $Q_-$ in frontier mode.

The two handles adjacent to $V_4$ determine these canonical nine points. The
other four handles change their source regions and the Case F/common-pair
checks; they do not independently change the nine-point formula.

The [nine-point theorem][f-theorem] closes the zero-gap branch with exactly
one actual supercritical row. The interface checks the selected critical row
and common-pair lower demands while keeping those checks separate from
sampled-source evidence. The optional disk of radius
$(\sqrt3/2)(1-c_*)$ lies inside the full radial hexagon and is a comparison
overlay, not an additional witness. In Newton mode the app still fits the
**six radial points plus A, B, C**, not a separately constrained disk fit.
Thus the paper's disk reduction satisfies
$\widehat K=\operatorname{conv}(\mathcal D_\eta\cup\{A,B,C\})
\subseteq\operatorname{conv}(K_N)\subseteq\operatorname{conv}(K_F)$.
Disabling radial witnesses removes the guarantee that the selected hull
contains the comparison disk. The displayed side always uses only enabled
points; numerical fitting is not an exact certificate. The former F surface, heatmap, slice, and
sampling controls have been removed. The separate exploratory Core Case mode
retains its existing behavior.

## Saving and loading

Controller snapshots use version 11. They store all BC/D boundary layouts,
the active layouts, F's boundary inputs, witness selections, each mode's
region visibility, F's disk visibility, F's `pointConstruction`
(`newton` or `frontier`), and the shared `dragBehavior`
(`stop` or `adjust-neighbors`). Missing movement preferences default to `stop`.
Regions and witness coordinates are recomputed on loading. Free
snapshots retain their own version. Older version-11 snapshots without region
visibility flags load with all six regions visible. Existing version-11 F
snapshots without `pointConstruction`, and migrated versions 8–10, load in
**frontier** mode to preserve their original point coordinates. New sessions
use Newton mode; both explicit selections round-trip without changing it.

Loading checks all five boundary layouts before applying the snapshot. Invalid
layouts reset to their matching feasible presets, and the load message lists
each replacement and its reason. Valid layouts, the active layout, witness
selections, visibility, and F's construction choice are preserved.

Controller versions 8–10 still load. The former `core-graph` mode becomes
`strategy3-f`. Valid saved F parameters are preserved by setting
$r_3=1-a$, $\ell_4=b$, and linearly interpolating the remaining shared
handoffs around the other five edges. Out-of-range parameters use the new
boundary preset. F selections and disk visibility are retained; version 8/9
$P_3,P_4,P_5$ selections map to $Q_-,Q_0,Q_+$, while the old $D_0,D_1,D_2$
selections remain available. Newly introduced witnesses start enabled.

Old independent BC/D parameters and triangle poses do not determine unique
boundary layouts. Loading initializes those layouts from the new presets,
retains witness selections, and reports the migration. Retired graph settings
are discarded. Other modes' saved-state behavior is preserved.

[restricted]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/2XXX_geometric_lemmas/20XX_V_triangle_geometry/2009X_ab_set/2009e_trace_exact_ab_envelopes.md
[neighbor]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/2XXX_geometric_lemmas/20XX_V_triangle_geometry/2008_neighbor_ray_max_c_formula.md
[radial]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/2XXX_geometric_lemmas/26XX_enclosing_triangle_tools/2608_residual_hull_finite_enclosure_principle.md
[bc-d]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/arrange/paper_draft/fixed_witness/06_fixed_witness_body.tex
[f-formulas]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/3XXX_CE0/31XX_Nplus1/310X_all_Vd0/3105X_self_contained_direct_Vd0_nine_point/31053_direct_asymmetric_witness_forcing.md
[f-theorem]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/3XXX_CE0/31XX_Nplus1/310X_all_Vd0/3105X_self_contained_direct_Vd0_nine_point/31058_center_independent_direct_nine_point_obstruction.md

[newton]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/arrange/paper_draft/E_zero_gap_nine_point_optimization.tex#L574-L628
