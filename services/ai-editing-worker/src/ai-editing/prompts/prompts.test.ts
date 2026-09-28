import { describe, expect, it } from 'vitest';
import {
  CODER_SYSTEM,
  FAST_SYSTEM,
  INTERPRET_SYSTEM,
  SUPERVISOR_SYSTEM,
} from './index';

describe('composed system prompts', () => {
  it('every role gets the ground rules exactly once', () => {
    for (const system of [
      SUPERVISOR_SYSTEM,
      INTERPRET_SYSTEM,
      CODER_SYSTEM,
      FAST_SYSTEM,
    ]) {
      expect(system.match(/read-only structural XML/g)).toHaveLength(1);
    }
  });

  it('editing roles share one copy of the editing rules and API', () => {
    for (const system of [CODER_SYSTEM, FAST_SYSTEM]) {
      expect(system.match(/## How you write edits/g)).toHaveLength(1);
      expect(system).toContain('editor.convertToHeading');
    }
    expect(SUPERVISOR_SYSTEM).not.toContain('## How you write edits');
  });

  it('the fast editor is not told it is on a team', () => {
    expect(FAST_SYSTEM).not.toContain('two-role editing system');
    expect(FAST_SYSTEM).not.toMatch(/\bsupervisor\b(?! and no other writers)/i);
    expect(CODER_SYSTEM).toContain('two-role editing system');
  });
});
