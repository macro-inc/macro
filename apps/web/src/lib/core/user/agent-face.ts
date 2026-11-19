import type { AgentFace } from '@macro-inc/agent-faces';

/**
 * The face an agent has before one is saved for it: seeded by a hash of its
 * user id, so the seed fits the server's 64 characters and carries no email.
 * Saving this face unchanged keeps the agent looking the same.
 */
export function derivedAgentFace(userId: string): AgentFace {
  return { v: 1, seed: idHash(userId), pins: {} };
}

/** 64 bits of the id as 16 hex characters (cyrb53's two 32-bit lanes). */
function idHash(id: string): string {
  let first = 0xdeadbeef;
  let second = 0x41c6ce57;
  for (let index = 0; index < id.length; index++) {
    const code = id.charCodeAt(index);
    first = Math.imul(first ^ code, 2654435761);
    second = Math.imul(second ^ code, 1597334677);
  }
  first = Math.imul(first ^ (first >>> 16), 2246822507);
  first ^= Math.imul(second ^ (second >>> 13), 3266489909);
  second = Math.imul(second ^ (second >>> 16), 2246822507);
  second ^= Math.imul(first ^ (first >>> 13), 3266489909);
  const hex = (lane: number) => (lane >>> 0).toString(16).padStart(8, '0');
  return `${hex(second)}${hex(first)}`;
}
