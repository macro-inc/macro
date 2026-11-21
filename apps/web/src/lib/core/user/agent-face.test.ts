import { describe, expect, it } from 'vitest';
import { derivedAgentFace } from './agent-face';

describe('derivedAgentFace', () => {
  it('seeds from a short hash of the id, never the id itself', () => {
    const id = `macro|${'a'.repeat(80)}@example.com`;
    const face = derivedAgentFace(id);
    expect(face.seed).toMatch(/^[0-9a-f]{16}$/);
    expect(face.seed).not.toContain('example');
    expect(face).toEqual({ v: 1, seed: face.seed, pins: {} });
  });

  it('is the same face for the same id, and another for another id', () => {
    expect(derivedAgentFace('macro|ada@example.com')).toEqual(
      derivedAgentFace('macro|ada@example.com')
    );
    expect(derivedAgentFace('macro|ada@example.com').seed).not.toBe(
      derivedAgentFace('macro|bo@example.com').seed
    );
  });
});
