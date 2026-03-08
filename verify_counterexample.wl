eps = SetPrecision[10^-30, 80];
bracketSamples = 256;
bisectionSteps = 80;
witnessX = SetPrecision[0.1115, 80];
graphSamples = 17;
svgPath = "verify_counterexample_mathematica.svg";

clamp01[x_] := Min[SetPrecision[1, Precision[x]], Max[SetPrecision[0, Precision[x]], x]];

orderedAdmissible[a_, b_, c_] := Module[{sum = a + b, circle, transition, cell1, cell2, cell3},
  circle = a^2 + a b + b^2;
  If[circle > 1 + eps, Return[False]];
  transition = sum^4 - sum^2 + a b;
  cell1 = sum <= 1 + eps && transition <= eps && c^4 - c^2 + a c - a^2 <= eps;
  cell2 = sum <= 1 + eps && transition >= -eps && (sum^2 - 1) c^2 + b c - b^2 <= eps;
  cell3 = sum >= 1 - eps && c <= 1/2 + eps && (a^2 - 1) c^2 + (2 a b^2 + b) c + (b^4 - b^2) <= eps;
  cell1 || cell2 || cell3
];

admissible[aIn_, bIn_, cIn_] := Module[{a = clamp01[aIn], b = clamp01[bIn], c = clamp01[cIn]},
  If[a <= b + eps, orderedAdmissible[a, b, c], orderedAdmissible[b, a, c]]
];

circleArcBound[aIn_] := Module[{a = clamp01[aIn]}, clamp01[(-a + Sqrt[Max[0, 4 - 3 a^2]])/2]];

maxCoverageBracket[aIn_, cIn_, samples_: bracketSamples, steps_: bisectionSteps] := Module[{a = clamp01[aIn], c = clamp01[cIn], upper, step, lo = -1, hi, b, i, mid},
  upper = circleArcBound[a];
  If[upper <= eps, Return[{0, 0}]];
  If[admissible[a, upper, c], Return[{upper, upper}]];
  step = upper/samples;
  hi = upper;
  Do[
    b = step i;
    If[admissible[a, b, c],
      lo = b;
      hi = Min[upper, b + step];
      Break[];
    ],
    {i, samples - 1, 0, -1}
  ];
  If[lo < 0, Return[{0, hi}]];
  Do[
    mid = (lo + hi)/2;
    If[admissible[a, mid, c], lo = mid, hi = mid],
    {steps}
  ];
  {lo, hi}
];

composeLocalCs[cs_, x_] := Fold[1 - First[maxCoverageBracket[#1, #2]] &, x, cs];

position = SetPrecision[{-0.025104244119199516, -0.4256560418598985}, 80];
angle = SetPrecision[-0.10228093308280761, 80];
circumradius = SetPrecision[1/Sqrt[3], 80];

triangle = Table[
  position + circumradius {Cos[angle + Pi/2 + k 2 Pi/3], Sin[angle + Pi/2 + k 2 Pi/3]},
  {k, 0, 2}
];
hexagon = Table[{Cos[i Pi/3], Sin[i Pi/3]}, {i, 0, 5}];

cross2[u_, v_] := u[[1]] v[[2]] - u[[2]] v[[1]];

raySegmentDistance[origin_, dir_, a_, b_] := Module[{len = Norm[dir], unit, edge, offset, denom, rayT, segT},
  If[len == 0, Return[Missing["NoHit"]]];
  unit = dir/len;
  edge = b - a;
  offset = a - origin;
  denom = cross2[unit, edge];
  If[Abs[denom] < 10^-12, Return[Missing["NoHit"]]];
  rayT = cross2[offset, edge]/denom;
  segT = cross2[offset, unit]/denom;
  If[rayT < -10^-12 || segT < -10^-12 || segT > 1 + 10^-12, Return[Missing["NoHit"]]];
  Max[rayT, 0]
];

rayPolygonExitDistance[origin_, dir_, poly_] := Module[{hits},
  hits = DeleteMissing@Table[raySegmentDistance[origin, dir, poly[[i]], poly[[Mod[i, Length[poly]] + 1]]], {i, 1, Length[poly]}];
  If[hits === {}, 0, Min[hits]]
];

localCs = N[1 - Table[rayPolygonExitDistance[{0, 0}, hexagon[[i]], triangle], {i, 1, 6}], 40];
witnessY = composeLocalCs[localCs, witnessX];

Print["witness_x = ", NumberForm[witnessX, {40, 30}]];
Print["c_i values:"];
Do[Print["  c_", i - 1, " = ", NumberForm[localCs[[i]], {40, 30}]], {i, 1, 6}];
Print[""];
Print["step data:"];

currentA = witnessX;
Do[
  bracket = maxCoverageBracket[currentA, localCs[[i]]];
  bLo = bracket[[1]];
  bHi = bracket[[2]];
  nextA = 1 - bLo;
  Print["  step ", i - 1, ":"];
  Print["    a_", i - 1, " = ", NumberForm[currentA, {40, 30}]];
  Print["    b_", i - 1, "_lo = ", NumberForm[bLo, {40, 30}]];
  Print["    b_", i - 1, "_hi = ", NumberForm[bHi, {40, 30}]];
  Print["    c_", i - 1, " = ", NumberForm[localCs[[i]], {40, 30}]];
  currentA = nextA,
  {i, 1, 6}
];

Print[""];
Print["summary:"];
Print["  G(x) = ", NumberForm[witnessY, {40, 30}]];
Print["  G(x) - x = ", NumberForm[witnessY - witnessX, {40, 30}]];

graphData = Table[
  With[
    {
      x = N[i/(graphSamples - 1), 30]
    },
    {
      x,
      N[Fold[1 - First[maxCoverageBracket[#1, #2, 96, 32]] &, x, localCs], 30]
    }
  ],
  {i, 0, graphSamples - 1}
];

leftGraphic = Graphics[
  {
    EdgeForm[Directive[Black, Thickness[0.003]]],
    FaceForm[None],
    Polygon[hexagon],
    {Directive[RGBColor[0.89, 0.93, 0.97], Thickness[0.002]], Table[Line[{{0, 0}, hexagon[[i]]}], {i, 1, 6}]},
    {Directive[RGBColor[0.03, 0.57, 0.70], Thickness[0.006]], Line[Append[triangle, First[triangle]]]},
    {Red, PointSize[0.018], Point[{0, 0}]},
    Table[Text[Style[Row[{"c", Subscript["", i - 1], " = ", NumberForm[localCs[[i]], {8, 6}]}], 11, FontFamily -> "Courier"], 0.72 hexagon[[i]]], {i, 1, 6}]
  },
  PlotRange -> {{-1.15, 1.15}, {-1.15, 1.15}},
  ImageSize -> 420
];

rightGraphic = Show[
  ListLinePlot[
    {
      Table[{x, x}, {x, 0, 1, 0.02}],
      graphData
    },
    PlotStyle -> {{Directive[Gray, Dashed]}, Directive[RGBColor[0.71, 0.33, 0.04], Thick]},
    PlotRange -> {{0, 1}, {0, 1}},
    Axes -> True,
    ImageSize -> 420
  ],
  Graphics[{
    Red, PointSize[0.018], Point[{witnessX, witnessY}],
    Text[Style[Row[{"(", NumberForm[witnessX, {6, 4}], ", ", NumberForm[witnessY, {6, 4}], ")"}], 11, FontFamily -> "Courier"], {0.45, 0.92}]
  }]
];

Export[
  svgPath,
  GraphicsRow[{leftGraphic, rightGraphic}, Spacings -> 20, ImageSize -> 960]
];

Print["plot written to ", svgPath];
