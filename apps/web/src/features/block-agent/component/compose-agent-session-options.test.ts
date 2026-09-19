import { describe, expect, it } from 'vitest';
import { harnessDisplayName } from './compose-agent-session-options';

describe('harnessDisplayName', () => {
  it('names Macro runtimes after the product', () => {
    expect(harnessDisplayName('in-memory')).toBe('Macro');
    expect(harnessDisplayName('sandbox')).toBe('Macro');
  });

  it('names the Cursor runtime', () => {
    expect(harnessDisplayName('cursor')).toBe('Cursor');
  });

  it('leaves registered harness names alone', () => {
    expect(harnessDisplayName('my-laptop')).toBe('my-laptop');
  });
});
