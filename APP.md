# App

## Purpose
This repository contains a Vite + TypeScript web app for exploring unit equilateral triangles against the regular hexagon skeleton.

## Run
- `npm install`
- `npm run dev`
- `npm run build`

## Main files
- `index.html`: app shell and canvases
- `src/main.ts`: app wiring, controls, state snapshots, rendering
- `src/interaction.ts`: pointer interaction state machine
- `src/maps.ts`: admissible-set predicate and one-variable map logic
- `src/region.ts`: graph canvas and composition plots
- `src/triangle.ts`: triangle and circle geometry on the left canvas
- `src/hexagon.ts`: hexagon boundary and main diagonals
- `src/coords.ts`: math-to-canvas coordinate transforms
- `src/geometry.ts`: pure geometric helpers
- `src/types.ts`: shared types
- `src/style.css`: layout and control styling

## Behavior
- All geometry is tracked in math coordinates.
- The left canvas shows the C-triangle or manual `c_i` controls.
- The right canvas shows `g_c`, pair compositions, or the six-step composition.
- Strict mode exposes `strictEps` and updates the admissible-set checks and local `c` bounds.
