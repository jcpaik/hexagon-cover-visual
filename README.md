# Hexagon Cover Visual

An interactive Vite + TypeScript app for exploring equilateral triangles,
covering regions, and conjectures on a regular hexagon.

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
  and Core modes. Free keeps its panels, drawing, sampling, and snapshot codec separate.
- `src/ab-union/`: AB-region geometry, state, rendering, and interaction.
- Other `src/` modules: shared geometry, interactions, and numerical models.
- `scripts/`: AB geometry/state, snapshot compatibility, and Cunion verification.

## Documentation

- [App behavior and architecture](docs/APP.md)
- [Mathematical definitions](docs/MATH.md)
- [Free mode](docs/FREEMODE.md)
- [Core case](docs/CORE_CASE.md)
- [Axis-aligned polygon hull](docs/AxisAlignedPolygonHull.md)

## Research

- [Counterexample](research/counterexample/README.md): retained snapshot,
  verifier, triangle data, and visualization.
- [Numerical experiments](research/experiments/README.md): NumPy probes.
- [Area conjecture](research/area-conjecture/README.md): current conjecture notes.
- [Half-skeleton proof targets](research/proofs/half-skeleton/README.md) and
  [reduction prompts](research/proofs/reductions/).
- [Prompts](research/prompts/) and [notes](research/notes/): research history and
  recorded experiments.
- [Standalone region explorer](research/legacy/hex_region_app.html): the original
  browser prototype, preserved for reference.
