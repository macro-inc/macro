import { describe, expect, it } from 'vitest';
import {
  harnessDisplayName,
  harnessTitle,
} from './compose-agent-session-options';

describe('harnessDisplayName', () => {
  it('names Macro runtimes after the product', () => {
    expect(harnessDisplayName('in-memory')).toBe('Macro Agent');
    expect(harnessDisplayName('macro-inmem')).toBe('Macro Agent');
    expect(harnessDisplayName('sandbox')).toBe('Macro Agent');
  });

  it('names the Cursor runtime', () => {
    expect(harnessDisplayName('cursor')).toBe('Cursor');
  });

  it('leaves registered harness names alone', () => {
    expect(harnessDisplayName('my-laptop')).toBe('my-laptop');
  });
});

describe('harnessTitle', () => {
  it('uses the product name for Macro slugs instead of title-casing them', () => {
    expect(harnessTitle('macro-inmem')).toBe('Macro Agent');
    expect(harnessTitle('in-memory')).toBe('Macro Agent');
  });

  it('title-cases other slugs', () => {
    expect(harnessTitle('claude-code')).toBe('Claude Code');
    expect(harnessTitle('codex-cloud')).toBe('Codex Cloud');
    expect(harnessTitle(undefined)).toBe('Agent session');
  });
});
