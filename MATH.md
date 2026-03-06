# Hexagon Skeleton And The Seven-Triangle Obstruction

## 1. Geometric setup

Let
\[
O := (0,0)
\]
be the center of the regular hexagon of side length `1`. We index the vertices by
\[
V_i = \bigl(\cos(i\pi/3),\, \sin(i\pi/3)\bigr), \qquad i=0,1,\dots,5,
\]
so in particular
\[
V_0=(1,0)
\]
and the indexing proceeds counterclockwise.

The **skeleton** is
\[
\operatorname{Sk} := \partial H \cup [V_0,V_3] \cup [V_1,V_4] \cup [V_2,V_5],
\]
that is, the boundary of the hexagon together with its three main diagonals.

The goal is to prove:

> Seven open equilateral triangles of side length $1$ cannot cover $\operatorname{Sk}$.

Everything in this note is organized around a contradiction argument: assume such a cover exists, encode the local geometric constraints, and derive an impossible six-step recurrence around the hexagon.

## 2. Standard reduction of a hypothetical 7-cover

Assume that `\operatorname{Sk}` is covered by seven open equilateral triangles of side length `1`.

Two pieces of the reduction are immediate.

1. Since the three diagonals meet at `O`, at least one covering triangle must contain `O`.
   Call this distinguished triangle the **C-triangle** and denote it by `T_C`.
2. Each vertex $V_i$ belongs to the skeleton, so for each `i` there is at least one covering triangle containing $V_i$.
   Fix one such triangle and call it the **$V_i$-triangle**, denoted `T_i`.

Thus the hypothetical cover can be organized as
\[
T_C,\ T_0,\ T_1,\ \dots,\ T_5.
\]

This labeling is only a bookkeeping device. The contradiction will come from comparing what `T_C` does along the six rays from the center with what each `T_i` can do near the corresponding vertex.

## 3. Inner gamma data of the C-triangle

For each `i`, consider the radial segment
\[
[O,V_i].
\]
Because `T_C` is convex and contains `O`, the ray from `O` through $V_i$ exits `T_C` in a unique point of `\partial T_C`. This gives a number
\[
\gamma_i := \operatorname{dist}\bigl(O,\, \partial T_C \cap [O,V_i]\bigr), \qquad i=0,\dots,5.
\]
The 6-tuple
\[
\gamma(T_C) := (\gamma_0,\dots,\gamma_5)
\]
is the **inner gamma** of the C-triangle.

### Notation cleanup

There is one typo-level inconsistency in the informal description that should be fixed explicitly:

- the phrase "the intersection of the boundary of the V-triangle and the line segment from `(0,0)` to $V_i$" cannot be right if the blue triangle in the app is meant to determine the inner gamma;
- the quantity `\gamma_i` must be read from the **C-triangle** `T_C`, not from the $V_i$-triangle.

That is the convention used in this note and in the UI.

## 4. Local coordinates for a $V_i$-triangle

Fix `i`, and look at the three skeleton segments incident to $V_i$:

- the boundary edge toward $V_{i-1}$,
- the boundary edge toward $V_{i+1}$,
- the diagonal toward `O`.

For a $V_i$-triangle we record three lengths:
\[
(a,b,c) \in [0,1]^3,
\]
where

- `a` is the length covered from $V_i$ toward $V_{i-1}$,
- `b` is the length covered from $V_i$ toward $V_{i+1}$,
- `c` is the length covered from $V_i$ toward `O`.

So `(a,b,c)` is a purely local description of how a unit equilateral triangle sitting at $V_i$ can meet the three incident skeleton branches.

## 5. The admissible set

The **admissible set** `\mathcal A \subset [0,1]^3` is the set of all triples `(a,b,c)` that can occur in the local picture above. It is given as the union of six closed semialgebraic cells.

### Cell 1
\[
a \le b
\]
\[
a+b \le 1
\]
\[
a^2+ab+b^2 \le 1
\]
\[
(a+b)^4-(a+b)^2+ab \le 0
\]
\[
c^4-c^2+ac-a^2 \le 0
\]

### Cell 2
\[
a \le b
\]
\[
a+b \le 1
\]
\[
a^2+ab+b^2 \le 1
\]
\[
(a+b)^4-(a+b)^2+ab \ge 0
\]
\[
((a+b)^2-1)c^2 + bc - b^2 \le 0
\]

### Cell 3
\[
a \le b
\]
\[
a+b \ge 1
\]
\[
a^2+ab+b^2 \le 1
\]
\[
(a^2-1)c^2 + (2ab^2+b)c + (b^4-b^2) \le 0
\]
\[
c \le \tfrac12
\]

### Cell 4
\[
b \le a
\]
\[
a+b \le 1
\]
\[
a^2+ab+b^2 \le 1
\]
\[
(a+b)^4-(a+b)^2+ab \le 0
\]
\[
c^4-c^2+bc-b^2 \le 0
\]

### Cell 5
\[
b \le a
\]
\[
a+b \le 1
\]
\[
a^2+ab+b^2 \le 1
\]
\[
(a+b)^4-(a+b)^2+ab \ge 0
\]
\[
((a+b)^2-1)c^2 + ac - a^2 \le 0
\]

### Cell 6
\[
b \le a
\]
\[
a+b \ge 1
\]
\[
a^2+ab+b^2 \le 1
\]
\[
(b^2-1)c^2 + (2ba^2+a)c + (a^4-a^2) \le 0
\]
\[
c \le \tfrac12
\]

The six-cell decomposition reflects two symmetries and two regime changes:

- the symmetry `a \leftrightarrow b`, corresponding to swapping clockwise and counterclockwise edges;
- the transition across `a+b=1`;
- the transition across
  \[
  (a+b)^4-(a+b)^2+ab = 0.
  \]

## 6. How the inner gamma talks to a $V_i$-triangle

This is the main notational point.

The inner gamma `\gamma_i` is measured from `O` outward along `[O,V_i]`. By contrast, the admissible-set coordinate `c` is measured from $V_i$ inward along `[V_i,O]`.

Therefore the two quantities are complementary:
\[
c_i = 1 - \gamma_i.
\]

So if `T_C` contributes the inner-gamma value `\gamma_i` on the diagonal `[O,V_i]`, then the corresponding local admissible slice for the $V_i$-triangle is obtained by setting
\[
c = c_i = 1-\gamma_i.
\]

This is the convention the app now displays explicitly:

- the left panel shows the six values `\gamma_0,\dots,\gamma_5` read from the blue C-triangle;
- the right panel studies the one-variable maps `g_c = f_{1-c}` and the full composition built from the current inner gamma data.

## 7. From the admissible set to a one-variable map

Fix `c \in [0,1]`. For each `a \in [0,1]`, define
\[
B_c(a) := \max\{b \in [0,1] : (a,b,c) \in \mathcal A\},
\]
whenever the slice is nonempty.

Then define the induced map
\[
f_c(a) := 1 - B_c(a).
\]

Interpretation:

- `a` is the uncovered amount arriving at $V_i$ from the previous edge,
- `B_c(a)` is the largest amount the $V_i$-triangle can cover on the next edge while still respecting the diagonal parameter `c`,
- `f_c(a)=1-B_c(a)` is the uncovered amount passed on to the next vertex.

So `f_c` is the local "defect propagation" map.

## 8. The six-step composition around the hexagon

Let `x_0 \in [0,1]` be the uncovered amount on the edge `[V_5,V_0]` adjacent to $V_0$. After the $V_0$-triangle acts, the uncovered amount handed to the next edge is
\[
x_1 = f_{c_0}(x_0).
\]
Continuing cyclically gives
\[
x_{i+1} = f_{c_i}(x_i), \qquad i=0,1,\dots,5,
\]
with indices taken mod `6`.

Hence after one full turn,
\[
x_6 = (f_{c_5} \circ f_{c_4} \circ \cdots \circ f_{c_0})(x_0).
\]
Using the relation `c_i = 1-\gamma_i`, this becomes
\[
x_6 = (f_{1-\gamma_5} \circ f_{1-\gamma_4} \circ \cdots \circ f_{1-\gamma_0})(x_0).
\]

If one prefers to parameterize the one-variable maps directly by inner gamma rather than by the complementary local coordinate, define
\[
g_\gamma := f_{1-\gamma}.
\]
Then the recurrence is simply
\[
x_6 = (g_{\gamma_5} \circ g_{\gamma_4} \circ \cdots \circ g_{\gamma_0})(x_0).
\]

This is the clean way to reconcile the composition formula with the geometric definition of `\gamma_i`.

## 9. The contradiction template

A seven-triangle covering would force the propagated defect after one full cycle not to exceed the defect we started with on the same edge. In symbols, one needs
\[
x_0 \ge x_6.
\]
With the notation above, that means
\[
x \ge (f_{1-\gamma_5} \circ f_{1-\gamma_4} \circ \cdots \circ f_{1-\gamma_0})(x)
\]
for every relevant `x \in [0,1]` and every inner-gamma tuple produced by a valid C-triangle.

Equivalently, in the `g_\gamma` notation,
\[
x \ge (g_{\gamma_5} \circ g_{\gamma_4} \circ \cdots \circ g_{\gamma_0})(x).
\]

So the global covering problem is reduced to a family of explicit one-dimensional inequalities built from admissible-set slices.

## 10. Dictionary between the math and the current app

- **Blue triangle on the left**: the C-triangle `T_C`.
- **Displayed tuple `γ`**: the six exit distances of `T_C` along the rays `[O,V_i]`.
- **Displayed tuple `1-γ`**: the six local diagonal parameters relevant for the six $V_i$-triangles.
- **Slider on the right**: a single-parameter graph of `g_c`; to study a specific vertex $V_i$, use `c = \gamma_i`.
- **Composition mode on the right**: the graph of `g_{\gamma_5} \circ \cdots \circ g_{\gamma_0}` for the current blue C-triangle.

## 11. What remains to prove mathematically

To finish the contradiction argument, one still needs a rigorous statement of the form:

1. every hypothetical 7-cover produces an inner-gamma tuple `\gamma(T_C)` and hence six local parameters `c_i = 1-\gamma_i`;
2. each $V_i$-triangle yields an admissible triple `(a_i,b_i,c_i)`;
3. the resulting composition map cannot satisfy the required cyclic inequality.

The admissible-set description is the local input. The composition inequality is the global output. The non-coverability statement follows once those two pieces are connected without exception.
