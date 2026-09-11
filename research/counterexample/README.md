# Skeleton Counterexample

## Summary
The current retained counterexample is stored in `counterexample_snapshot.json`.

From that snapshot, `counterexample_cover.py` constructs seven closed equilateral triangles, each with side strictly less than `1`, and verifies that their union covers all six boundary edges and all six center-to-vertex rays of the unit hexagon skeleton.

This is a skeleton-cover example. The upstream [proved theorem](https://github.com/dylan0301/hexagon-cover-database/blob/a98c71c12f1b521a1e58353e56b11474e1ec4f9b/proof/0XXX_main/0000_main_theorem.md)
concerns the filled hexagon; the script does not verify coverage of its interior.
The retained version-2 snapshot is input for this Python verifier. The current
browser controller loader accepts versions 8–10, so this historical snapshot
cannot be loaded directly into the current app.

## Relevant files
- `counterexample_snapshot.json`: the web-app controller snapshot that produces the counterexample
- `counterexample_cover.py`: verification and geometric realization code
- `counterexample_cover.json`: explicit triangle data (side lengths, centers, angles, vertices)
- `counterexample_cover.svg`: SVG visualization of the seven optimized triangles

## How to rerun

Run from the repository root:

```bash
python3 research/counterexample/counterexample_cover.py
```

To verify a different snapshot file:

```bash
python3 research/counterexample/counterexample_cover.py path/to/snapshot.json
```

The default snapshot and generated JSON/SVG are beside the script, regardless
of the working directory. An explicit snapshot path is relative to the working
directory.

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
