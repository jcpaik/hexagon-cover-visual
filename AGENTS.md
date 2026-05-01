# Hexagon Cover Visual

## Project Summary

This is a Vite + TypeScript browser app for exploring a regular hexagon skeleton and the triangle-cover geometry around it. The main UI draws a hexagon skeleton, a central C-triangle or C-circle, derived `gamma` and `c_i` values, map/composition graphs, and an optional live overlay of six perimeter `V_i` triangles with skeleton coverage gaps.

The app is static/client-only. There is no backend service.

## Common Commands

- `npm install`: install dependencies.
- `npm run dev`: start the Vite dev server.
- `npm run build`: type-check and build the production site into `dist/`.
- `npm run preview`: preview the production build locally.
- `python3 counterexample_cover.py`: regenerate the saved counterexample SVG/JSON from `counterexample_snapshot.json`.

## Main Directory Files

- `index.html`: browser app shell. Defines the two canvas panels, shape/map controls, strict-check controls, cover overlay toggle, admissible-function editor, and controller-state editor.
- `package.json`: npm scripts and dev dependencies for Vite and TypeScript.
- `package-lock.json`: locked npm dependency versions.
- `vite.config.ts`: Vite configuration. Currently uses the default config.
- `tsconfig.json`: TypeScript compiler settings.
- `APP.md`: short app overview and file map.
- `MATH.md`: mathematical explanation of the hexagon skeleton, C-triangle gamma values, local admissible coordinates, and composition argument.
- `COUNTEREXAMPLE.md`: explanation of the retained counterexample artifacts and how to regenerate them.
- `counterexample_snapshot.json`: saved controller snapshot used by the Python counterexample generator.
- `counterexample_cover.py`: Python script that derives seven triangles from a snapshot, verifies skeleton coverage, and exports SVG/JSON artifacts.
- `counterexample_cover.json`: explicit generated triangle data for the retained counterexample.
- `counterexample_cover.svg`: SVG visualization of the retained seven-triangle counterexample.
- `prompts/`: saved prompt/context notes. Treat as user-owned content unless explicitly asked to edit.
- `dist/`: generated production build output after `npm run build`. Do not edit by hand.
- `node_modules/`: installed dependencies. Do not edit by hand.

## Source Files

- `src/main.ts`: main app wiring. Owns UI state, snapshot load/save, event listeners, render orchestration, cover overlay drawing, and communication with the graph renderer.
- `src/style.css`: layout and visual styling for panels, canvases, buttons, editors, readouts, and overlay controls.
- `src/types.ts`: shared TypeScript types for points, shape modes, triangle state, and pointer interaction state.
- `src/coords.ts`: math-coordinate to canvas-coordinate transforms and responsive canvas sizing configuration.
- `src/geometry.ts`: pure geometry helpers: distances, point-in-shape checks, segment projection, clamping, rotation, and ray intersections.
- `src/hexagon.ts`: regular hexagon vertex constants and drawing of the hexagon boundary plus three main diagonals.
- `src/triangle.ts`: C-triangle/C-circle geometry, drawing, valid centroid region, control point drawing, and gamma extraction along hexagon rays.
- `src/maps.ts`: admissible-set predicate, strict epsilon handling, `g_c`, pair composition, full local-`c` composition, and chain value computation.
- `src/region.ts`: right-side graph canvas renderer for single `g_c`, pair composition, and full six-step composition.
- `src/interaction.ts`: pointer interaction state machine for dragging/moving/rotating the C-shape, editing manual `c_i`, selecting start values, and toggling half-diagonals.
- `src/cover.ts`: live TypeScript port of the needed counterexample-cover logic. Fits six perimeter `V_i` triangles, computes triangle halfplanes, intersects them with skeleton segments, merges covered intervals, and reports uncovered gaps.

## Editing Notes

- Prefer keeping mathematical helper code pure and isolated in `src/geometry.ts`, `src/maps.ts`, or `src/cover.ts`.
- UI state and DOM wiring should stay in `src/main.ts`.
- The Python counterexample generator is a reference implementation for saved artifacts, not runtime website code.
- If changing geometry or admissible-map behavior, run `npm run build` and manually compare the website against the relevant explanation in `MATH.md`.
