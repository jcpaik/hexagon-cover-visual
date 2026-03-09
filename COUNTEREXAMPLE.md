# Counterexample

## Summary
The current retained counterexample is stored in `counterexample_snapshot.json`.

From that snapshot, `counterexample_cover.py` constructs seven closed equilateral triangles, each with side strictly less than `1`, and verifies that their union covers all six boundary edges and all six center-to-vertex rays of the unit hexagon skeleton.

## Relevant files
- `counterexample_snapshot.json`: the web-app controller snapshot that produces the counterexample
- `counterexample_cover.py`: verification and geometric realization code
- `counterexample_cover.json`: explicit triangle data (side lengths, centers, angles, vertices)
- `counterexample_cover.svg`: SVG visualization of the seven optimized triangles

## How to rerun
```bash
python3 counterexample_cover.py
```

To verify a different snapshot file:
```bash
python3 counterexample_cover.py path/to/snapshot.json
```

## Current output
For the retained snapshot, the optimized side lengths are all `< 1`:
- `C = 0.997938057288`
- `V0 = 0.999413329246`
- `V1 = 0.999200000000`
- `V2 = 0.999200000000`
- `V3 = 0.999494082847`
- `V4 = 0.999200000000`
- `V5 = 0.999469224232`

The script also checks that every edge interval and every diagonal interval is fully covered.
