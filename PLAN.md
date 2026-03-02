# Hexagon Cover Visual — Vite Project Setup

## Context
Set up a minimal Vite/vanilla-TS project with an HTML canvas showing a regular hexagon and an interactive equilateral triangle with drag (translate), rotate (around a movable control point), and cursor feedback.

## File Structure
```
hexagon-cover-visual/
  package.json          — vite + typescript devDeps, "dev"/"build" scripts
  tsconfig.json         — ES2020, ESNext modules, strict
  vite.config.ts        — minimal (no plugins needed)
  index.html            — centered <canvas id="canvas"> + script module
  src/
    style.css           — canvas border, body centering, user-select:none
    types.ts            — Point, InteractionState union type
    coords.ts           — math ↔ canvas pixel transforms
    geometry.ts         — pure math utilities
    hexagon.ts          — hexagon vertices + draw
    triangle.ts         — triangle state, vertex computation, draw
    interaction.ts      — mouse events, hit testing, state machine, cursors
    main.ts             — entry point: canvas, state, render loop, wire interaction
```

## Coordinate System (`coords.ts`)
- Math space: hexagon vertices at distance 1 from origin
- Canvas: 600×600 CSS pixels (buffer scaled by `devicePixelRatio`)
- Transform: `canvasX = 300 + 240 * mathX`, `canvasY = 300 - 240 * mathY`
- Exports: `mathToCanvas(p)`, `canvasToMath(p)`, `scaleToCanvas(d)`
- Parameters (canvas size, scale, center) stored in a mutable config object so they can be adjusted at runtime

## Hexagon (`hexagon.ts`)
Vertices in counterclockwise order:
```
(1, 0), (1/2, √3/2), (-1/2, √3/2), (-1, 0), (-1/2, -√3/2), (1/2, -√3/2)
```
Draw: white fill, black stroke, closed path.
Also draw three main diagonals (each connecting opposite vertices, length 2): (1,0)↔(-1,0), (1/2,√3/2)↔(-1/2,-√3/2), (-1/2,√3/2)↔(1/2,-√3/2). Black stroke.

## Triangle (`triangle.ts`)

### State
```ts
{ position: Point, angle: number, controlPoint: Point }
```
- `position`: centroid in math coords, initially (0,0)
- `angle`: rotation in radians, initially 0
- `controlPoint`: rotation pivot, initially (0,0)

### Vertex Computation
Equilateral triangle, side 1, circumradius = `1/√3`.
Vertices at angles `angle + π/2 + k·2π/3` (k=0,1,2), distance `1/√3` from centroid, then shifted by `position`.

### Translation
```
position += delta
controlPoint += delta   // moves with triangle
```

### Rotation (around control point)
```
angle += dTheta
position = rotatePoint(position, controlPoint, dTheta)
// controlPoint stays fixed
```

### Drawing
- Triangle: light blue stroke (`#89CFF0`), no fill
- Control point: small circle (~4px radius), light blue fill (`#89CFF0`), grey (#999) stroke

## Geometry Utilities (`geometry.ts`)
- `distance(a, b)`, `add(a, b)`, `subtract(a, b)`
- `rotatePoint(p, center, angle)` — rotate p around center
- `pointInTriangle(p, v0, v1, v2)` — cross-product sign test
- `distanceToSegment(p, a, b)` — perpendicular distance to line segment
- `distanceToTriangleBorder(p, vertices)` — min of 3 edge distances

## Interaction State Machine (`interaction.ts`)

**Design note**: State machine via TS discriminated union. Type-safe and explicit, but adding new interactive objects requires growing the union. If we later add more shapes, we can refactor to per-object interaction handlers (each object registers its own onDown/onMove/onUp, a dispatcher routes by hit-test priority). Fine for now with one triangle.

### States
```ts
type InteractionState =
  | { kind: 'idle' }
  | { kind: 'dragging-triangle'; startMouse: Point; startPos: Point; startControl: Point }
  | { kind: 'rotating-triangle'; startMouse: Point; startAngle: number; startPos: Point }
  | { kind: 'dragging-control-point'; startMouse: Point; startControl: Point }
```

### Hit Test Priority (on mousedown)
1. **Control point** — mouse within ~8px → `dragging-control-point`
2. **Triangle border** — mouse within ~6px of any edge → `rotating-triangle`
3. **Triangle interior** — point-in-triangle test → `dragging-triangle`
4. **Nothing** — stay `idle`

### Mouse Events
- **mousedown**: convert to math coords, run hit tests, store initial state
- **mousemove**:
  - If idle: update cursor based on hover target
  - If dragging-triangle: `position = startPos + (mouse - startMouse)`, same for controlPoint
  - If rotating-triangle: `dTheta = atan2(mouse - controlPt) - atan2(startMouse - controlPt)`, apply rotation
  - If dragging-control-point: `controlPoint = startControl + (mouse - startMouse)`
  - Call `render()` after state update
- **mouseup**: reset to idle
- **mouseleave**: reset to idle (or use window-level capture)

### Rotation Angle Computation
```ts
const startAngleToCP = atan2(startMouse.y - cp.y, startMouse.x - cp.x)
const currAngleToCP  = atan2(mouse.y - cp.y, mouse.x - cp.x)
const dTheta = currAngleToCP - startAngleToCP
// Apply: triangle.angle = origAngle + dTheta
//        triangle.position = rotatePoint(origPos, cp, dTheta)
```

### Cursor Map (hover, idle state only)
| Target | Cursor |
|---|---|
| Control point | `pointer` |
| Triangle border | `alias` (rotation arrow) |
| Triangle interior | `move` |
| Elsewhere | `default` |

## Main Entry Point (`main.ts`)
- Get canvas, context
- Initialize triangle state
- `render()`: clearRect → drawHexagon → drawTriangle → drawControlPoint
- `setupInteraction(canvas, state, render)`: register mouse events
- Call `render()` once

## Implementation Order
1. **Scaffold**: package.json, tsconfig, vite config, index.html, style.css → `npm install`
2. **Static scene**: types, coords, geometry, hexagon, triangle, main → verify render
3. **Interaction**: interaction.ts, wire events → test drag/rotate/cursor

## Verification
- `npm run dev` → browser shows canvas with thin border
- Hexagon drawn correctly (6 vertices, black stroke, white bg)
- Triangle at origin with visible control point dot
- Drag inside triangle → parallel translation, control point follows
- Drag on triangle border → rotation around control point, cursor shows `alias`
- Drag control point → moves independently, cursor shows `pointer`
- HiDPI: sharp rendering on retina displays
