# Hexagon Cover Visual

## Project Setup
- Vite 7.3.1 + TypeScript 5.9.3, vanilla (no framework)
- `npm run dev` to start dev server

## File Structure
```
index.html              — canvas element, loads src/main.ts
src/
  style.css             — canvas border, body centering, user-select:none
  types.ts              — Point, TriangleState, InteractionState (discriminated union)
  coords.ts             — math ↔ canvas pixel transforms (mutable config object)
  geometry.ts           — pure math: distance, rotation, point-in-triangle, distance-to-segment, clamp-to-triangle
  hexagon.ts            — hexagon vertices (6) + 3 main diagonals, white fill, black stroke
  triangle.ts           — triangle state/vertices/draw, valid region computation, light blue (#89CFF0)
  interaction.ts        — mouse state machine, hit testing, cursor management
  main.ts               — entry point: HiDPI canvas, state init, render, wire interaction
```

## Architecture
- All geometry in math coordinates; canvas pixels only at draw/mouse boundaries
- Coordinate transform: `canvasX = center + scale * mathX`, `canvasY = center - scale * mathY`
- Interaction state machine: idle | dragging-triangle | rotating-triangle | dragging-control-point
- Hit test priority: control point > border > interior
- Delta-from-start pattern for dragging (no cumulative drift)
- Re-render on mouse events only (no animation loop)

## Constraints
- Triangle must always contain the origin (0,0)
- Translation: centroid clamped to valid region (reflected triangle centered at origin)
- Rotation: rejected if origin would end up outside triangle

## TODOs
- Describe the problem/algorithm, plan together with user and Claude
- Describe the visuals to achieve, plan together with user and Claude
- Implement further features
