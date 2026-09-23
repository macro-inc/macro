import { CLAUDE_BOT_ID } from '@core/constant/claudeAgent';
import { CODEX_BOT_ID } from '@core/constant/codexAgent';
import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { describe, expect, it } from 'vitest';
import {
  harnessDisplayName,
  harnessTitle,
  sessionHarnessTitle,
  sessionRepositoryUrl,
  showsSessionHarness,
} from './compose-agent-session-options';

describe('sessionRepositoryUrl', () => {
  const repoUrl = 'https://github.com/macro-inc/macro';

  it('shows the repository of a coding session', () => {
    expect(sessionRepositoryUrl({ harness: 'cursor', repoUrl })).toBe(repoUrl);
    expect(sessionRepositoryUrl({ harness: 'macrod', repoUrl })).toBe(repoUrl);
  });

  it('hides the default repository stamped on a chat session', () => {
    expect(sessionRepositoryUrl({ harness: 'in-memory', repoUrl })).toBe(
      undefined
    );
    expect(sessionRepositoryUrl({ harness: 'macro-inmem', repoUrl })).toBe(
      undefined
    );
  });

  it('is empty without a session or repository', () => {
    expect(sessionRepositoryUrl(undefined)).toBe(undefined);
    expect(sessionRepositoryUrl({ harness: 'cursor', repoUrl: null })).toBe(
      undefined
    );
  });
});

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
    expect(harnessTitle('sandbox')).toBe('Macro Agent');
  });

  it('title-cases other slugs', () => {
    expect(harnessTitle('claude-code')).toBe('Claude Code');
    expect(harnessTitle('codex-cloud')).toBe('Codex Cloud');
    expect(harnessTitle(undefined)).toBe('Agent session');
  });
});

describe('sessionHarnessTitle', () => {
  it.each([
    [CURSOR_BOT_ID, 'Cursor'],
    [CODEX_BOT_ID, 'Codex Cloud'],
    [CLAUDE_BOT_ID, 'Claude Cloud'],
  ] as const)(
    'names a %s session from the bot even when the row says opencode',
    (botId, title) => {
      expect(sessionHarnessTitle({ harness: 'opencode', botId })).toBe(title);
    }
  );

  it('title-cases other sessions from their stored slug', () => {
    expect(sessionHarnessTitle({ harness: 'claude-cloud' })).toBe(
      'Claude Cloud'
    );
  });

  it('uses the product name for Macro slugs', () => {
    expect(sessionHarnessTitle({ harness: 'macro-inmem' })).toBe('Macro Agent');
    expect(sessionHarnessTitle({ harness: 'in-memory' })).toBe('Macro Agent');
  });
});

describe('showsSessionHarness', () => {
  it('hides the Details row for in-memory chat agents', () => {
    expect(showsSessionHarness({ harness: 'in-memory' })).toBe(false);
    expect(showsSessionHarness({ harness: 'macro-inmem' })).toBe(false);
    expect(showsSessionHarness({})).toBe(false);
  });

  it('keeps the Details row for coding runtimes', () => {
    expect(showsSessionHarness({ harness: 'cursor' })).toBe(true);
    expect(showsSessionHarness({ harness: 'claude-cloud' })).toBe(true);
    expect(showsSessionHarness({ harness: 'sandbox' })).toBe(true);
    expect(showsSessionHarness({ harness: 'my-laptop' })).toBe(true);
  });

  it('keeps the Details row for first-party coding bots stamped opencode', () => {
    expect(
      showsSessionHarness({ harness: 'opencode', botId: CURSOR_BOT_ID })
    ).toBe(true);
  });
});
