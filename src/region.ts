/**
 * WebGL renderer for implicit regions in the (a, b) plane.
 *
 * Draws a full-screen quad and evaluates region inequalities
 * per-pixel in a fragment shader.
 */

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
out vec2 v_pos;
void main() {
  v_pos = a_position;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// The fragment shader maps clip-space coordinates to math (a, b) coordinates
// using uniforms for center and scale, then tests region inequalities.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_pos;
out vec4 fragColor;

uniform vec2 u_origin;   // math-space coords at lower-left corner
uniform vec2 u_extent;   // math-space size of viewport (width, height)

uniform float u_lineWidth; // curve thickness in pixels
uniform float u_c;         // slider parameter c in [0, 1]

// Region colors — up to 8 regions
uniform int u_regionCount;
uniform vec4 u_regionColors[8];

// Map clip coords to math coords: lower-left = u_origin, upper-right = u_origin + u_extent
vec2 toMath(vec2 clip) {
  return u_origin + (clip * 0.5 + 0.5) * u_extent;
}

// Generic implicit curve mask: given f and grad(f), return anti-aliased stroke alpha.
float implicitMask(float f, vec2 grad) {
  float gradLen = length(grad);
  if (gradLen < 1e-8) return 0.0;
  float dist = abs(f) / gradLen;
  float pixelSize = fwidth(dist);
  float halfWidth = u_lineWidth * 0.5 * pixelSize;
  return 1.0 - smoothstep(halfWidth - pixelSize * 0.5, halfWidth + pixelSize * 0.5, dist);
}

// Curve 1: a + b - 1 = 0
float curve1Mask(float a, float b) {
  float f = a + b - 1.0;
  vec2 grad = vec2(1.0, 1.0);
  return implicitMask(f, grad);
}

// Curve 2: a^2 + ab + b^2 - 1 = 0
float curve2Mask(float a, float b) {
  float f = a*a + a*b + b*b - 1.0;
  vec2 grad = vec2(2.0*a + b, a + 2.0*b);
  return implicitMask(f, grad);
}

// Curve 3: ((a+b)^2 - 1) c^2 + b c - b^2 = 0
float curve3Mask(float a, float b) {
  float c = u_c;
  float ab = a + b;
  float f = (ab*ab - 1.0)*c*c + b*c - b*b;
  // df/da = 2(a+b) c^2
  // df/db = 2(a+b) c^2 + c - 2b
  float dab = 2.0 * ab * c * c;
  vec2 grad = vec2(dab, dab + c - 2.0*b);
  return implicitMask(f, grad);
}

// Curve 4: (a^2 - 1) c^2 + (2 a b^2 + b) c + (b^4 - b^2) = 0
float curve4Mask(float a, float b) {
  float c = u_c;
  float b2 = b*b;
  float f = (a*a - 1.0)*c*c + (2.0*a*b2 + b)*c + (b2*b2 - b2);
  // df/da = 2a c^2 + 2 b^2 c
  // df/db = (4ab + 1) c + 4b^3 - 2b
  vec2 grad = vec2(
    2.0*a*c*c + 2.0*b2*c,
    (4.0*a*b + 1.0)*c + 4.0*b2*b - 2.0*b
  );
  return implicitMask(f, grad);
}

// Axis line mask (for a=0 or b=0)
float axisMask(float coord) {
  float pixelSize = fwidth(coord);
  float dist = abs(coord);
  float halfWidth = 0.5 * pixelSize;
  return 1.0 - smoothstep(halfWidth - pixelSize * 0.5, halfWidth + pixelSize * 0.5, dist);
}

// Test if point (a, b) is inside each region.
// Returns a bitmask (bit k set = inside region k).
int testRegions(float a, float b) {
  int mask = 0;

  // Region 0: a >= 0 && b >= 0 && a*a + a*b + b*b <= 1
  if (a >= 0.0 && b >= 0.0 && a*a + a*b + b*b <= 1.0) {
    mask |= 1;
  }

  return mask;
}

void main() {
  vec2 p = toMath(v_pos);
  float a = p.x;
  float b = p.y;

  // Start with white background
  vec3 color = vec3(1.0);

  // Fill regions
  int mask = testRegions(a, b);
  if (mask != 0) {
    vec3 regionColor = vec3(0.0);
    int count = 0;
    for (int i = 0; i < 8; i++) {
      if (i >= u_regionCount) break;
      if ((mask & (1 << i)) != 0) {
        regionColor += u_regionColors[i].rgb;
        count++;
      }
    }
    if (count > 0) {
      regionColor /= float(count);
    }
    color = regionColor;
  }

  // Draw axes (thin grey lines)
  float axisA = axisMask(a);
  float axisB = axisMask(b);
  float axisAlpha = max(axisA, axisB);
  color = mix(color, vec3(0.7), axisAlpha);

  // Curve 1: a + b = 1 — red
  color = mix(color, vec3(0.9, 0.2, 0.2), curve1Mask(a, b));
  // Curve 2: a^2 + ab + b^2 = 1 — dark blue
  color = mix(color, vec3(0.1, 0.2, 0.8), curve2Mask(a, b));
  // Curve 3: ((a+b)^2 - 1)c^2 + bc - b^2 = 0 — dark green
  color = mix(color, vec3(0.1, 0.6, 0.2), curve3Mask(a, b));
  // Curve 4: (a^2-1)c^2 + (2ab^2+b)c + (b^4-b^2) = 0 — orange
  color = mix(color, vec3(0.9, 0.5, 0.1), curve4Mask(a, b));

  fragColor = vec4(color, 1.0);
}
`;

export interface RegionRenderer {
  render(): void;
  setView(originA: number, originB: number, extent: number): void;
  setRegionColor(index: number, r: number, g: number, b: number, a: number): void;
  setRegionCount(count: number): void;
  setLineWidth(pixels: number): void;
  setC(c: number): void;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error('Shader compile error: ' + info);
  }
  return shader;
}

export function createRegionRenderer(canvas: HTMLCanvasElement): RegionRenderer {
  const gl = canvas.getContext('webgl2', { antialias: false })!;
  if (!gl) throw new Error('WebGL2 not supported');

  // Compile shaders
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

  const program = gl.createProgram()!;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(program));
  }

  // Full-screen quad: two triangles covering [-1, 1]
  const quadVerts = new Float32Array([
    -1, -1, 1, -1, -1, 1,
    -1, 1, 1, -1, 1, 1,
  ]);
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  // Uniforms
  const uOrigin = gl.getUniformLocation(program, 'u_origin')!;
  const uExtent = gl.getUniformLocation(program, 'u_extent')!;
  const uLineWidth = gl.getUniformLocation(program, 'u_lineWidth')!;
  const uC = gl.getUniformLocation(program, 'u_c')!;
  const uRegionCount = gl.getUniformLocation(program, 'u_regionCount')!;
  const uRegionColors: WebGLUniformLocation[] = [];
  for (let i = 0; i < 8; i++) {
    uRegionColors.push(gl.getUniformLocation(program, `u_regionColors[${i}]`)!);
  }

  // State: (0,0) at lower-left, show [0, extent] x [0, extent]
  let originA = -0.2;
  let originB = -0.2;
  let extent = 1.6;
  let lineWidth = 2.0;
  let cValue = 0.5;
  let regionCount = 1;
  const regionColors = new Float32Array(8 * 4);
  // Default: region 0 = light blue
  regionColors[0] = 0.537; // #89CFF0
  regionColors[1] = 0.812;
  regionColors[2] = 0.941;
  regionColors[3] = 1.0;

  // HiDPI
  const dpr = window.devicePixelRatio || 1;
  const cssSize = 600;
  canvas.width = cssSize * dpr;
  canvas.height = cssSize * dpr;
  canvas.style.width = cssSize + 'px';
  canvas.style.height = cssSize + 'px';

  function render(): void {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);

    gl.uniform2f(uOrigin, originA, originB);
    gl.uniform2f(uExtent, extent, extent);
    gl.uniform1f(uLineWidth, lineWidth);
    gl.uniform1f(uC, cValue);
    gl.uniform1i(uRegionCount, regionCount);
    for (let i = 0; i < 8; i++) {
      gl.uniform4f(
        uRegionColors[i],
        regionColors[i * 4],
        regionColors[i * 4 + 1],
        regionColors[i * 4 + 2],
        regionColors[i * 4 + 3],
      );
    }

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  return {
    render,
    setView(oa: number, ob: number, ext: number): void {
      originA = oa;
      originB = ob;
      extent = ext;
    },
    setRegionColor(index: number, r: number, g: number, b: number, a: number): void {
      regionColors[index * 4] = r;
      regionColors[index * 4 + 1] = g;
      regionColors[index * 4 + 2] = b;
      regionColors[index * 4 + 3] = a;
    },
    setRegionCount(count: number): void {
      regionCount = count;
    },
    setLineWidth(pixels: number): void {
      lineWidth = pixels;
    },
    setC(c: number): void {
      cValue = c;
    },
  };
}
