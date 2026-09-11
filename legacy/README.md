# Research Archive

Historical research and the original browser prototype are preserved here.
These files record the questions and app behavior at the time they were
written. Their proof-task wording is historical; current status is summarized
below and in the [hexagon-cover database][database].

Reviewed on 2026-09-11 against database revision
[`a98c71c12f1b521a1e58353e56b11474e1ec4f9b`][revision]. The numbered proof
sources record theorem status and hypotheses; the [paper][paper] presents the
completed filled-hexagon proof. Archiving a file does not by itself mean its
claims were proved or disproved.

## Inventory

All 58 archived files retain their original contents apart from repaired
paths. The two Hull Debug JSON datasets remain beside their referring prompts.

| Material | Files | Reason for archiving and current status |
| --- | ---: | --- |
| [Prompts](research/prompts/) | 30 | Historical implementation requests and mathematical investigations, including two saved datasets. |
| [Half-skeleton targets](research/proofs/half-skeleton/README.md) | 19 | Earlier solver-task bundle with mixed resolution. The CE1 and CE2 interval targets have proved successors in [2102][ce1] and [2103][ce2]; the V cases relate to the [midpoint inventory][midpoints], which does not mark every old frontier target as solved. |
| [Reduction prompts](research/proofs/reductions/) | 3 | Retired routes with different statuses; see the reduction history below. |
| [May notes](research/notes/) | 3 | Dated classification and skeleton-proof discussions. The incomplete CE2 interval note has a proved successor with explicit hypotheses in [2104][one-interval]. |
| [July pink-curve regression](research/notes/20260706-pink-curve-regression.md) | 1 | Numerical observations for the earlier relaxed six-point Core model, superseded as a proof route by Strategy 3. |
| [Area-conjecture note](research/area-conjecture/README.md) | 1 | Superseded by Strategy 2's completed area proof. Its separate optimizer-shape conjecture is historical and unnecessary to that proof. |
| [Standalone region explorer](research/hex_region_app.html) | 1 | Original browser prototype whose functionality was incorporated into the app's AB Union mode. |

## Completed area and Core proofs

**Strategy 2 proves the area inequality.** For feasible cyclic pairs
$(a_i,b_i)=(1-x_{i-1},x_i)$ with at least two supercritical rows, the
[area package][area-proof] proves
$\sum_i f(a_i,b_i)<99/20<5$, strengthening the old note's proposed bound
of six. Here $f$ is normalized retained area. The proof uses unconditional
local square-loss bounds and the [cyclic area-loss argument][area-interface].
The old [optimizer-shape conjecture][area-structure] remains a separate,
unproved statement that is no longer a dependency. Numerical mode behavior
is documented in [APP.md](../docs/APP.md#max-area-and-area-conj-modes).

**Strategy 3 develops the Core construction into a proved nine-point
obstruction.** Six radial witnesses and three frontier witnesses close the
zero-gap case with exactly one supercritical actual row, independently of
the center and vertex types. See the [paper's construction][nine-paper] and
[canonical nine-point theorem][nine-proof]. The app's six-point Core Case model
remains documented in [CORE_CASE.md](../docs/CORE_CASE.md); the graph now uses
the [nine-point F construction](../docs/STRATEGY3.md#f-nine-point-core).

The July regression remains an empirical observation about the old relaxed
six-point model. The nine-point theorem does not prove that model's sampled
minimum-curve conjecture. The related [relaxed six-point computation memo][six-point]
records its earlier research context. Core's plotted quantity is enclosing
triangle side length, distinct from the area function above.

## Reduction history

- **May 21 general reduction:** the imported [specification][may21] has
  [exact counterexamples][may21-counterexamples] to its general four-point
  route. Restricted Pattern A results retain their stated hypotheses.
- **May 21 alternate strategies:** the [alternate specification][may21-alternate]
  includes a separate midpoint-window question that remains unresolved.
- **May 25 reduction:** the [upstream archive][may25] retires the complicated
  supremum-endpoint route without disproving its target inequality.

## Retained tools

The seven files in [counterexample](../research/counterexample/README.md) and
[numerical experiments](../research/experiments/README.md) remain under
`research/` as reusable tools and their supporting data. The counterexample
checks the hexagon skeleton; the [proved noncoverage theorem][main-theorem]
concerns the filled hexagon. The [skeleton-strategy postmortem][skeleton]
explains why that earlier global obstruction was retired.

[database]: https://github.com/dylan0301/hexagon-cover-database
[revision]: https://github.com/dylan0301/hexagon-cover-database/commit/a98c71c12f1b521a1e58353e56b11474e1ec4f9b
[paper]: https://github.com/dylan0301/hexagon-cover-database/tree/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/arrange
[main-theorem]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/0XXX_main/0000_main_theorem.md
[ce1]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/2XXX_geometric_lemmas/21XX_C_triangle_geometry/2102_CE1_M0_e01_maximal_intervals.md
[ce2]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/2XXX_geometric_lemmas/21XX_C_triangle_geometry/2103_CE2_M0_e50_e01_maximal_interval_pairs.md
[midpoints]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/1XXX_foundations/12XX_V_triangle/1205_midpoint_subsets.md
[one-interval]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/2XXX_geometric_lemmas/21XX_C_triangle_geometry/2104_CE2_one_interval_lemma.md
[area-proof]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/3XXX_CE0/32XX_Nplus_ge2/3201_area_conjecture_index.md
[area-interface]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/2XXX_geometric_lemmas/24XX_area_loss/2400_zero_gap_area_loss_interface.md
[area-structure]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/3XXX_CE0/32XX_Nplus_ge2/3202_area_function_and_monotonicity.md#historical-structural-conjecture
[nine-paper]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/arrange/paper_draft/06_finite_enclosure_full.tex
[nine-proof]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/3XXX_CE0/31XX_Nplus1/310X_all_Vd0/3105X_self_contained_direct_Vd0_nine_point/31058_center_independent_direct_nine_point_obstruction.md
[six-point]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/3XXX_CE0/31XX_Nplus1/310X_all_Vd0/3101X_six_point/31018_ray_transition_computation_memo.md
[may21]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/9XXX_failed_ideas/965X_may21_patternA_support/9652_reduction_prompt_spec.md
[may21-counterexamples]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/9XXX_failed_ideas/965X_may21_patternA_support/9654_band_window_counterexamples.md
[may21-alternate]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/9XXX_failed_ideas/965X_may21_patternA_support/9653_alternate_strategies_spec.md
[may25]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/9XXX_failed_ideas/963X_may25_five_point_failure/9631_CE0_may25_supremum_endpoint_archive.md
[skeleton]: https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/9XXX_failed_ideas/908X_skeleton_cover_counterexample/9080_full_skeleton_noncoverage_postmortem.md
