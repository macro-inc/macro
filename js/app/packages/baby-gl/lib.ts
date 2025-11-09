export type ShaderKind = 'vertex' | 'fragment';
export type UniformKind = 'float' | 'vec2' | 'vec3' | 'vec4';

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Vec4 = readonly [number, number, number, number];

export const vec2 = (x: number, y: number): Vec2 => [x, y];
export const vec3 = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const vec4 = (x: number, y: number, z: number, w: number): Vec4 => [
  x,
  y,
  z,
  w,
];

export type ValueMap = {
  float: number;
  vec2: Vec2 | Float32Array;
  vec3: Vec3 | Float32Array;
  vec4: Vec4 | Float32Array;
};

export type UniformDef<T extends UniformKind = UniformKind> = {
  type: T;
  default: ValueMap[T];
};

export type UniformConfig = Record<string, UniformDef>;

export type UniformSchema = Record<string, UniformKind>;

export type UniformSetters<T extends UniformSchema> = {
  [K in keyof T]: (value: ValueMap[T[K]]) => void;
};

export type UniformValues<T extends UniformSchema> = {
  [K in keyof T]: ValueMap[T[K]];
};

type Meta = {
  location: WebGLUniformLocation;
  kind: UniformKind;
};

/**
 * Format shader source with line numbers and error highlighting
 */
function formatShaderWithLineNumbers(
  source: string,
  errorLine?: number
): string {
  const lines = source.split('\n');
  return lines
    .map((line, index) => {
      const lineNum = index + 1;
      const prefix = lineNum.toString().padStart(3, ' ') + ': ';
      const isErrorLine = errorLine && lineNum === errorLine;
      return isErrorLine ? `>>> ${prefix}${line} <<<` : `    ${prefix}${line}`;
    })
    .join('\n');
}

function parseErrorLine(errorLog: string): number | undefined {
  const match = errorLog.match(/ERROR:\s*\d+:(\d+):/);
  return match ? parseInt(match[1], 10) : undefined;
}

function shaderError(
  message: string,
  source?: string,
  type?: ShaderKind
): never {
  let errorMessage = `Shader Error: ${message}`;
  if (source) {
    const errorLine = parseErrorLine(message);
    errorMessage += `\n\n${type?.toUpperCase()} SHADER SOURCE:\n`;
    errorMessage += formatShaderWithLineNumbers(source, errorLine);
  }
  throw new Error(errorMessage);
}

/**
 * Compile a shader from source code.
 * @param gl - The WebGL2RenderingContext.
 * @param type - The type of shader to compile.
 * @param src - The source code of the shader.
 */
export function compileShader(
  gl: WebGL2RenderingContext,
  type: ShaderKind,
  src: string
) {
  const shader = gl.createShader(
    type === 'vertex' ? gl.VERTEX_SHADER : gl.FRAGMENT_SHADER
  );
  if (!shader) {
    throw new Error('failed to create shader');
  }
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const errorLog = gl.getShaderInfoLog(shader) || 'Unknown compilation error';
    shaderError(`failed to compile ${type} shader: ${errorLog}`, src, type);
  }
  return shader;
}

/**
 * Create, link and validate a program from vertex and fragment shaders.
 * @param gl - The WebGL2RenderingContext.
 * @param vertexShader - The vertex shader.
 * @param fragmentShader - The fragment shader.
 * @returns
 */
export function createProgram(
  gl: WebGL2RenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader
) {
  const program = gl.createProgram();
  if (!program) {
    throw new Error('failed to create program');
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    shaderError(`failed to link program: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);
  return program;
}

function ensureProgram(gl: WebGL2RenderingContext, program: WebGLProgram) {
  if (
    (gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram | null) !== program
  ) {
    gl.useProgram(program);
  }
}

/**
 * Get a typed uniform setter for a given program and config. This will log
 * errors to the console if the uniform config/schema does not match the
 * the shader program.
 * @param gl - WebGL2RenderingContext
 * @param program - WebGLProgram
 * @param config - A custom uniform config object.
 * @returns A object with a use utility for setting uniforms.
 * @example
 * const uniformsSchema = {
 *   uParam: {type: 'float', default: 0.5},
 *   uColor: {type: 'vec3', default: vec3(0, 1, 0)},
 * };
 * const { set, uniforms } = bindUniforms(gl, program, uniformsSchema);
 *
 * // this will work
 * set({
 *   uParam: 0.7,
 *   uColor: vec3(1, 0, 0),
 * });
 *
 * // so will
 * uniforms.uColor(vec3(1, 0, 1));
 */
export function bindUniforms<T extends UniformConfig>(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  config: T
) {
  const meta: Record<string, Meta> = {};

  const schema: Record<string, UniformKind> = {};
  const defaults: Record<string, any> = {};

  for (const [name, def] of Object.entries(config)) {
    schema[name] = def.type;
    defaults[name] = def.default;
  }

  for (const [name, kind] of Object.entries(schema)) {
    const loc = gl.getUniformLocation(program, name);
    if (!loc) {
      console.error(`Uniform "${name}" not found on program`);
      continue;
    }
    meta[name] = { location: loc, kind };
  }

  const use = () => {
    ensureProgram(gl, program);
  };

  function setOne(m: Meta, v: any) {
    switch (m.kind) {
      case 'float':
        gl.uniform1f(m.location, v as number);
        break;
      case 'vec2':
        gl.uniform2fv(m.location, v as Vec2 | Float32Array);
        break;
      case 'vec3':
        gl.uniform3fv(m.location, v as Vec3 | Float32Array);
        break;
      case 'vec4':
        gl.uniform4fv(m.location, v as Vec4 | Float32Array);
        break;
    }
  }

  const uniforms = {} as UniformSetters<
    T extends UniformConfig ? { [K in keyof T]: T[K]['type'] } : never
  >;
  for (const [name, m] of Object.entries(meta)) {
    uniforms[name as keyof typeof uniforms] = (value: any) => {
      use();
      setOne(m, value);
    };
  }

  function set(
    values: Partial<
      UniformValues<
        T extends UniformConfig ? { [K in keyof T]: T[K]['type'] } : never
      >
    >
  ) {
    use();
    for (const k in values) {
      const m = meta[k];
      if (!m) continue;
      setOne(m, values[k as keyof typeof values]);
    }
  }

  // Apply defaults immediately
  use();
  for (const [name, value] of Object.entries(defaults)) {
    const m = meta[name];
    if (m) setOne(m, value);
  }

  return { use: () => ensureProgram(gl, program), uniforms, set };
}

export type Drawable = {
  draw: (options?: { bind?: boolean }) => void;
  bind: () => void;
  delete: () => void;
};

/**
 * Create a full-screen quad drawable (fills the screen in clip space)
 * @param gl
 * @param program
 * @param positionAttribName is the name of the attribute in the shader that should
 *     receive the position data. Throws an ERROR if the attribute is not found.
 * @returns
 */
export function fullScreenQuad(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  positionAttribName: string
): Drawable {
  const aPosition = gl.getAttribLocation(program, positionAttribName);
  if (aPosition === -1) {
    throw new Error(`Attribute ${positionAttribName} not found`);
  }

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  // TRIANGLE_STRIP positions for a full-screen quad.
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(aPosition);

  gl.bindVertexArray(null);

  return {
    draw: (options = { bind: true }) => {
      if (options.bind !== false) {
        gl.bindVertexArray(vao);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    bind: () => {
      gl.bindVertexArray(vao);
    },
    delete: () => {
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(quad);
    },
  };
}

/**
 * Measure the css pixel size of a canvas element.
 * @param canvas
 * @returns A width, height tuple.
 */
export function getCanvasSize(canvas: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 1;
  const cssH = canvas.clientHeight || 1;
  const w = Math.max(1, Math.floor(cssW * dpr));
  const h = Math.max(1, Math.floor(cssH * dpr));
  return [w, h] as Vec2;
}
