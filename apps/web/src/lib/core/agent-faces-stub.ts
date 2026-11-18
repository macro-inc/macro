// Stand-in for `@macro-inc/agent-faces` (packages/agent-faces) with the same
// exported types and signatures. Delete this file when the package lands and
// import from the package instead.
import { z } from 'zod';

export type FacePart =
  | 'hair'
  | 'hairColor'
  | 'skin'
  | 'eyes'
  | 'glasses'
  | 'headwear'
  | 'background';

/** A face as stored: a seed plus the parts its owner pinned. */
export type AgentFace = {
  v: 1;
  seed: string;
  pins: Partial<Record<FacePart, number>>;
};

const agentFaceSchema = z.object({
  v: z.literal(1),
  seed: z.string().min(1),
  pins: z.record(z.string(), z.number()),
});

/** The stored JSON as a face, or `undefined` when it is not one this app can draw. */
export function parseAgentFace(json: unknown): AgentFace | undefined {
  const parsed = agentFaceSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

/** An SVG string for the face; `size` is the edge it will be shown at, in pixels. */
export function renderFace(face: AgentFace, _opts?: { size?: number }): string {
  const hue = [...face.seed].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="hsl(${hue % 360} 70% 80%)"/><circle cx="50" cy="45" r="26" fill="#EDB98A"/></svg>`;
}
