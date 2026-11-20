import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it } from 'vitest';
import { ConversationRowRoot } from './root';
import { ConversationRowTitle } from './title';
import { ConversationRowTrailing } from './trailing';

afterEach(cleanup);

it.each([false, true])(
  'keeps the title truncated under a separately masked timestamp surface (active: %s)',
  (active) => {
    const { container } = render(() => (
      <ConversationRowRoot
        id="session"
        title="A long conversation title that remains truncated"
        kind="chat"
        state="dormant"
        active={active}
      >
        <ConversationRowTitle />
        <ConversationRowTrailing age="2h" />
      </ConversationRowRoot>
    ));
    const title = screen.getByText(
      'A long conversation title that remains truncated'
    );
    expect(title.classList.contains('truncate')).toBe(true);
    expect(title.classList.contains('min-w-0')).toBe(true);
    const fade = container.querySelector('[data-conversation-age-fade]');
    expect(fade?.className).toContain('black_24px');
    expect(fade?.className).toContain('var(--color-panel)');
    expect(fade?.className).toContain('var(--conversation-row-overlay)');
    expect(fade?.getAttribute('aria-hidden')).toBe('true');
    const row = container.querySelector('[data-agent-session-row]');
    expect(row?.className).toContain(
      'focus-within:[--conversation-row-overlay:var(--color-hover)]'
    );
    expect(row?.className).toContain('group-data-[state=open]/cm-trigger');
    expect(row?.getAttribute('aria-current')).toBe(active ? 'page' : null);
    expect(
      screen
        .getByText('2h')
        .classList.contains('group-hover/conversation:opacity-100')
    ).toBe(true);
  }
);
