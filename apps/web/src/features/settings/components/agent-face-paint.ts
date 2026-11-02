import {
  type AgentFaceLook,
  type AgentFacePose,
  agentFaceColor,
  projectAgentFace,
  RESTING_POSE,
} from '../core/agent-face';

type Rgb = readonly [number, number, number];
const mix = (a: Rgb, b: Rgb, p: number): Rgb => [
  a[0] + (b[0] - a[0]) * p,
  a[1] + (b[1] - a[1]) * p,
  a[2] + (b[2] - a[2]) * p,
];
const rgba = (c: Rgb, alpha = 1) =>
  `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;

/** Paints a Mark face filling a `size`-pixel square of `ctx`. */
export function paintAgentFace(
  ctx: CanvasRenderingContext2D,
  size: number,
  look: AgentFaceLook,
  pose: AgentFacePose,
  dark: boolean
) {
  const { polygons, shadow } = projectAgentFace(look.style, pose);
  const material = agentFaceColor(look.color).material[dark ? 'dark' : 'light'];
  ctx.save();
  ctx.scale(size / 120, size / 120);

  const shade: Rgb = dark ? [0, 0, 0] : [29, 28, 26];
  const radius = shadow.radius * (1 - 0.3 * shadow.lift);
  const glow = ctx.createRadialGradient(
    shadow.x,
    shadow.y,
    0,
    shadow.x,
    shadow.y,
    radius
  );
  glow.addColorStop(
    0,
    rgba(shade, (dark ? 0.34 : 0.2) * (1 - 0.5 * shadow.lift))
  );
  glow.addColorStop(1, rgba(shade, 0));
  ctx.save();
  ctx.translate(shadow.x, shadow.y);
  ctx.scale(1, 0.4);
  ctx.translate(-shadow.x, -shadow.y);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(shadow.x, shadow.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.lineJoin = 'round';
  for (const polygon of polygons) {
    const color = mix(material.shade, material.lit, polygon.light);
    ctx.beginPath();
    polygon.points.forEach(([x, y], index) =>
      index === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    );
    ctx.closePath();
    ctx.fillStyle = rgba(color);
    ctx.fill();
    // A hairline in the face's own color closes seams between sides; a
    // brighter edge on top faces reads as a polished bevel.
    ctx.lineWidth = 0.5;
    ctx.strokeStyle = polygon.top
      ? rgba(mix(color, [255, 255, 255], 0.35))
      : rgba(color);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A square picture of the face on a soft wash of its color, for places that
 * show agents as images (mentions, channels, direct messages). The base stays
 * transparent so it sits on light and dark themes alike.
 */
export async function agentFaceImage(
  look: AgentFaceLook,
  size = 512
): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable');
  // Ink's swatch is near black; a grey wash keeps it visible on dark themes.
  const swatch =
    look.color === 'ink' ? '#a8a49c' : agentFaceColor(look.color).swatch.light;

  const wash = ctx.createRadialGradient(
    size / 2,
    size * 0.46,
    0,
    size / 2,
    size * 0.46,
    size * 0.72
  );
  wash.addColorStop(0, `${swatch}4d`);
  wash.addColorStop(0.5, `${swatch}24`);
  wash.addColorStop(1, `${swatch}0f`);
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, size, size);

  // Inset so the face sits centered inside a round avatar crop.
  const inset = size * 0.14;
  ctx.translate(inset, inset * 0.8);
  paintAgentFace(ctx, size - inset * 2, look, restingFacePose, false);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/png')
  );
  if (!blob) throw new Error('Could not draw the agent’s face');
  return new File([blob], `agent-${look.style}-${look.color}.png`, {
    type: 'image/png',
  });
}

/** A slight glance to the right, so the picture doesn't stare. */
const restingFacePose: AgentFacePose = {
  ...RESTING_POSE,
  lookX: 0.15,
  lookY: 0.05,
};
