export type Oklch = { l: number; c: number; h: number };

export function parseOklch(input: string): Oklch | undefined {
  // Accept formats like: oklch(0.7 0.15 30), oklch(70% 0.15 30deg)
  const m = input
    .trim()
    .match(/^oklch\(\s*([^\s]+)\s+([^\s]+)\s+([^\s]+)\s*\)$/i);
  if (!m) return undefined;
  let [lRaw, cRaw, hRaw] = m.slice(1);

  // Handle % for lightness
  let l: number;
  if (lRaw.endsWith('%')) {
    const v = Number(lRaw.slice(0, -1));
    if (Number.isNaN(v)) return undefined;
    l = v / 100;
  } else {
    const v = Number(lRaw);
    if (Number.isNaN(v)) return undefined;
    l = v;
  }

  // Chroma (unitless in our usage)
  const c = Number(cRaw);
  if (Number.isNaN(c)) return undefined;

  // Hue can have deg suffix
  let h: number;
  if (hRaw.toLowerCase().endsWith('deg')) {
    const v = Number(hRaw.slice(0, -3));
    if (Number.isNaN(v)) return undefined;
    h = v;
  } else {
    const v = Number(hRaw);
    if (Number.isNaN(v)) return undefined;
    h = v;
  }

  return { l, c, h };
}

export function formatOklch({ l, c, h }: Oklch): string {
  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${((h % 360) + 360) % 360})`;
}

export function applyConstraints(
  base: Oklch,
  candidate: Oklch,
  constraints?: { lockL?: boolean; lockC?: boolean; lockH?: boolean }
): Oklch {
  return {
    l: constraints?.lockL ? base.l : candidate.l,
    c: constraints?.lockC ? base.c : candidate.c,
    h: constraints?.lockH ? base.h : candidate.h,
  };
}
