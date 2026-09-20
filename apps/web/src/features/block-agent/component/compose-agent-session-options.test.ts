import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { describe, expect, it } from 'vitest';
import {
  harnessDisplayName,
  sessionHarnessTitle,
} from './compose-agent-session-options';

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

describe('sessionHarnessTitle', () => {
  it('names a Cursor session Cursor even when the row says opencode', () => {
    expect(
      sessionHarnessTitle({ harness: 'opencode', botId: CURSOR_BOT_ID })
    ).toBe('Cursor');
  });

  it('title-cases other sessions from their stored slug', () => {
    expect(sessionHarnessTitle({ harness: 'claude-cloud' })).toBe(
      'Claude Cloud'
    );
  });
});
