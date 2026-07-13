type StringLike =
  | string
  | number
  | boolean
  | null
  | undefined
  | { toString(): string };

const toStr = (x: StringLike) =>
  x == null ? '' : Array.isArray(x) ? x.join('') : String(x);

/**
 * Glsl tagged templates. Trims outer blank lines, normalizes EOLs, and dedents
 * to minimal indent.
 *
 * @example
 * const shader = glsl`
 *   precision mediump float;
 *
 *   void main() {
 *     gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
 *   }
 * `;
 */
export function glsl(
  strings: TemplateStringsArray,
  ...exprs: StringLike[]
): string {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < exprs.length) out += toStr(exprs[i]);
  }

  out = out.replace(/\r\n?/g, '\n');

  // trim leading and trailing blank line
  out = out.replace(/^\s*\n/, '').replace(/\n\s*$/, '');

  const matches = out.match(/^[ \t]*(?=\S)/gm);
  const min = matches ? Math.min(...matches.map((s) => s.length)) : 0;
  if (min > 0) out = out.replace(new RegExp(`^[ \\t]{${min}}`, 'gm'), '');
  return out;
}
