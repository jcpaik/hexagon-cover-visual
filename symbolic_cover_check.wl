ClearAll["Global`*"];

hexagon = Table[{Cos[i Pi/3], Sin[i Pi/3]}, {i, 0, 5}];
circumradius = 1/Sqrt[3];
inradius = 1/(2 Sqrt[3]);

cCenter = {cx, cy};
cAngle = thetaC;
startX = x0;

bracketSamples = 512;
bisectionSteps = 140;
searchTolerance = 10^-30;
workingPrecision = 80;

cPhi := cAngle + Pi/2;
cTriangleVertices := Table[
  cCenter + circumradius {Cos[cPhi + 2 Pi k/3], Sin[cPhi + 2 Pi k/3]},
  {k, 0, 2}
];

(* Half-plane description of the C-triangle.
   Each side is n.x <= lambda. *)
cNormals := Table[
  -{Cos[cPhi + 2 Pi k/3], Sin[cPhi + 2 Pi k/3]},
  {k, 0, 2}
];

cLambdas := Table[
  cNormals[[k]].cCenter + inradius,
  {k, 1, 3}
];

originInsideCQ := And @@ Thread[cLambdas >= 0];

gamma[i_Integer] := Min @@ Table[
  Piecewise[
    {
      {
        cLambdas[[k]]/(cNormals[[k]].hexagon[[i + 1]]),
        cNormals[[k]].hexagon[[i + 1]] > 0
      }
    },
    Infinity
  ],
  {k, 1, 3}
];

localC[i_Integer] := Max[0, 1 - gamma[i]];

orderedAdmissible[a_, b_, c_] := Module[{sum = a + b, circle, transition},
  circle = a^2 + a b + b^2;
  transition = sum^4 - sum^2 + a b;
  circle <= 1 &&
    (
      (
        sum <= 1 &&
        transition <= 0 &&
        c^4 - c^2 + a c - a^2 <= 0
      ) ||
      (
        sum <= 1 &&
        transition >= 0 &&
        (sum^2 - 1) c^2 + b c - b^2 <= 0
      ) ||
      (
        sum >= 1 &&
        c <= 1/2 &&
        (a^2 - 1) c^2 + (2 a b^2 + b) c + (b^4 - b^2) <= 0
      )
    )
];

admissible[a_, b_, c_] := Piecewise[
  {
    {orderedAdmissible[a, b, c], a <= b},
    {orderedAdmissible[b, a, c], a > b}
  }
];

clamp01[x_?NumericQ] := Clip[N[x, workingPrecision], {0, 1}];

circleArcBound[a_?NumericQ] := Module[{aa = clamp01[a]},
  clamp01[(-aa + Sqrt[Max[0, 4 - 3 aa^2]])/2]
];

orderedAdmissibleQ[a_?NumericQ, b_?NumericQ, c_?NumericQ] := TrueQ[orderedAdmissible[a, b, c]];

admissibleQ[a_?NumericQ, b_?NumericQ, c_?NumericQ] := Module[
  {
    aa = clamp01[a],
    bb = clamp01[b],
    cc = clamp01[c]
  },
  If[aa <= bb, orderedAdmissibleQ[aa, bb, cc], orderedAdmissibleQ[bb, aa, cc]]
];

maxCoverageNumeric[a_?NumericQ, c_?NumericQ, samples_: bracketSamples, steps_: bisectionSteps] := Module[
  {
    aa = clamp01[a],
    cc = clamp01[c],
    upper,
    step,
    lo = -1,
    hi,
    b,
    mid
  },
  upper = circleArcBound[aa];
  If[upper <= searchTolerance, Return[0]];
  If[admissibleQ[aa, upper, cc], Return[upper]];

  step = upper/samples;
  hi = upper;
  Do[
    b = step i;
    If[admissibleQ[aa, b, cc],
      lo = b;
      hi = Min[upper, b + step];
      Break[];
    ],
    {i, samples - 1, 0, -1}
  ];

  If[lo < 0, Return[0]];

  Do[
    mid = (lo + hi)/2;
    If[admissibleQ[aa, mid, cc],
      lo = mid,
      hi = mid
    ],
    {steps}
  ];

  lo
];

gNumeric[c_?NumericQ][a_?NumericQ] := 1 - maxCoverageNumeric[a, c];

gammaNumeric[i_Integer, rules_List, prec_: 50] := N[gamma[i] /. rules, prec];

localCNumeric[rules_List, prec_: 50] := Table[
  N[Max[0, 1 - gammaNumeric[i, rules, prec]], prec],
  {i, 0, 5}
];

sequenceNumeric[rules_List, prec_: 50] := Module[
  {
    x = N[startX /. rules, prec],
    cs = localCNumeric[rules, prec]
  },
  FoldList[gNumeric[#2][#1] &, x, cs]
];

checkNumeric[rules_List, prec_: 50] := Module[
  {
    cs = localCNumeric[rules, prec],
    seq = sequenceNumeric[rules, prec],
    x = N[startX /. rules, prec]
  },
  <|
    "localCs" -> cs,
    "sequence" -> seq,
    "gap" -> Last[seq] - x,
    "coverQ" -> Last[seq] <= x,
    "counterexampleQ" -> Last[seq] > x
  |>
];

closureGap[rules_List, prec_: 50] := checkNumeric[rules, prec]["gap"];
coverCondition[rules_List, prec_: 50] := checkNumeric[rules, prec]["coverQ"];
counterexampleCondition[rules_List, prec_: 50] := checkNumeric[rules, prec]["counterexampleQ"];

witnessRules = {
  cx -> -0.025104244119199516,
  cy -> -0.4256560418598985,
  thetaC -> -0.10228093308280761,
  x0 -> 0.1115
};

coverRules = {
  cx -> -0.025104244119199516,
  cy -> -0.4256560418598985,
  thetaC -> -0.10228093308280761,
  x0 -> 0.9173668553244948
};

(* Fast usage:

   Get["/Users/jcpaik/Documents/research/hexagon-cover-visual/symbolic_cover_check.wl"];

   localCNumeric[witnessRules, 60]
   sequenceNumeric[witnessRules, 60]
   closureGap[witnessRules, 60]
   counterexampleCondition[witnessRules, 60]

   localCNumeric[coverRules, 60]
   sequenceNumeric[coverRules, 60]
   closureGap[coverRules, 60]
   coverCondition[coverRules, 60]

   rules = {
     cx -> -0.02,
     cy -> -0.42,
     thetaC -> -0.10,
     x0 -> 0.9
   };

   checkNumeric[rules, 60]

   The symbolic objects that remain lightweight are:
     cTriangleVertices
     cNormals
     cLambdas
     gamma[i]
     localC[i]

   Avoid FullSimplify on the full six-step composition. The intended workflow is:
   keep cx, cy, thetaC, x0 symbolic in the definitions, then substitute rules and
   use the numeric check functions above.
*)
