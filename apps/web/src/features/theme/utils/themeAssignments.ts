import { alphaToken, mixTokens, tokenReference } from './themeColorTokens';

export type ThemeAssignment =
  | { kind: 'custom'; value: string }
  | { kind: 'linked'; token: string; alpha: number }
  | {
      kind: 'mixed';
      first: string;
      second: string;
      mix: number;
      alpha: number;
      space?: 'oklch' | 'srgb';
    };

const ALPHA_WRAPPER = /^color-mix\(in oklch, (.+) ([\d.]+)%, transparent\)$/;
const LINK = /^var\(--color-([a-z0-9-]+)\)$/;
const MIX =
  /^color-mix\(in (oklch|srgb), var\(--color-([a-z0-9-]+)\) ([\d.]+)%, var\(--color-([a-z0-9-]+)\)\)$/;

export function parseThemeAssignment(value: string): ThemeAssignment {
  let expression = value.trim();
  let alpha = 1;
  const alphaMatch = expression.match(ALPHA_WRAPPER);
  if (alphaMatch) {
    expression = alphaMatch[1] ?? expression;
    alpha = Number(alphaMatch[2]) / 100;
  }

  const link = expression.match(LINK);
  if (link?.[1]) return { kind: 'linked', token: link[1], alpha };

  const mix = expression.match(MIX);
  if (mix?.[1] && mix[2] && mix[3] && mix[4]) {
    return {
      kind: 'mixed',
      first: mix[2],
      second: mix[4],
      mix: Number(mix[3]) / 100,
      alpha,
      ...(mix[1] === 'srgb' && { space: 'srgb' as const }),
    };
  }

  return { kind: 'custom', value };
}

export function serializeThemeAssignment(assignment: ThemeAssignment): string {
  if (assignment.kind === 'custom') return assignment.value;

  const base =
    assignment.kind === 'linked'
      ? tokenReference(assignment.token)
      : mixTokens(
          assignment.first,
          assignment.second,
          assignment.mix,
          assignment.space
        );

  if (assignment.alpha >= 0.999) return base;
  if (assignment.kind === 'linked') {
    return alphaToken(assignment.token, assignment.alpha);
  }
  return `color-mix(in oklch, ${base} ${Math.round(assignment.alpha * 10000) / 100}%, transparent)`;
}
