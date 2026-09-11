# Hexagon Cover Visual

An interactive Vite + TypeScript app for exploring equilateral triangles,
covering regions, and proved obstruction constructions on a regular hexagon.

## Run and verify

```bash
npm install
npm run dev
npm run build
npm run verify
```

Use `npm run preview` to inspect the production build. See
[deployment instructions](docs/DEPLOY.md) for publishing with `npm run deploy`.

## Code

- `index.html` and `src/main.ts`: app shell and bootstrap.
- `src/app/`: shared app wiring, controls, state snapshots, and rendering.
- `src/modes/`: controllers for base shapes, Free, AB Union, Hull Debug, Area,
  Core, and Strategy 3 modes. Free keeps its panels, drawing, sampling, and snapshot codec separate.
- `src/strategy3/`: BC/D/F boundary state, case-specific source constraints, analytic
  witness geometry, and shared drawing.
- `src/ab-union/`: ordinary and restricted AB-region geometry, state, rendering,
  and interaction, shared with Strategy 3.
- Other `src/` modules: shared geometry, interactions, and numerical models.
- `scripts/`: AB geometry/state, snapshot compatibility, Cunion, and Strategy 3 verification.

## Documentation

- [App behavior and architecture](docs/APP.md)
- [Mathematical definitions](docs/MATH.md)
- [Free mode](docs/FREEMODE.md)
- [Core case](docs/CORE_CASE.md)
- [Strategy 3 constructions](docs/STRATEGY3.md): six-point BC, four-point D,
  and nine-point F modes driven by movable boundary dots and restricted AB regions,
  with independent region visibility controls.
- [Axis-aligned polygon hull](docs/AxisAlignedPolygonHull.md)

## Research

- [Current proof and paper](https://github.com/dylan0301/hexagon-cover-database):
  the filled-hexagon theorem, including Strategy 2's area proof and Strategy 3's
  nine-point obstruction developed from the earlier Core research.
- [Skeleton counterexample](research/counterexample/README.md): retained snapshot,
  verifier, triangle data, and visualization for the boundary and diagonals.
- [Numerical experiments](research/experiments/README.md): NumPy probes.
- [Research archive](legacy/README.md): historical prompts, proof targets, area
  and Core research, and the original browser prototype, with upstream status
  and successor references.
