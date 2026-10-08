/**
 * Arithmetic in number fields, as Figma allows ("100*2", "48/3+4"):
 * numbers, + − × ÷, unary minus, and parentheses. Anything else is `null`.
 */

export function evaluate(text: string): number | null {
  const s = text.replace(/\s+/g, '');
  let at = 0;
  const peek = () => s[at];

  const number = (): number | null => {
    const m = /^\d*\.?\d+(e[+-]?\d+)?/i.exec(s.slice(at));
    if (!m) return null;
    at += m[0].length;
    return Number(m[0]);
  };

  const factor = (): number | null => {
    if (peek() === '-') {
      at++;
      const v = factor();
      return v === null ? null : -v;
    }
    if (peek() === '+') {
      at++;
      return factor();
    }
    if (peek() === '(') {
      at++;
      const v = sum();
      if (v === null || peek() !== ')') return null;
      at++;
      return v;
    }
    return number();
  };

  const product = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === '*' || peek() === '/')) {
      const op = s[at++];
      const r = factor();
      if (r === null) return null;
      v = op === '*' ? v * r : v / r;
    }
    return v;
  };

  const sum = (): number | null => {
    let v = product();
    while (v !== null && (peek() === '+' || peek() === '-')) {
      const op = s[at++];
      const r = product();
      if (r === null) return null;
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };

  const v = sum();
  return v !== null && at === s.length && Number.isFinite(v) ? v : null;
}
