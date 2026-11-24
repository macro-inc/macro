import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConversationRowRoot } from './root';
import { ConversationRowTitle } from './title';
import { ConversationRowTrailing } from './trailing';

vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => false,
}));

beforeEach(() => {
  vi.stubEnv('MODE', 'development');
  const rects = [new DOMRect(0, 0, 40, 40)];
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue(
    Object.assign(rects, { item: (index: number) => rects[index] ?? null })
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

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

it('shows the conversation tooltip only while the title is truncated', () => {
  let width = 40;
  const { container } = render(() => (
    <ConversationRowRoot
      id="session"
      title="Conversation name"
      kind="chat"
      state="dormant"
    >
      <ConversationRowTitle />
    </ConversationRowRoot>
  ));
  const title = screen.getByText('Conversation name');
  vi.spyOn(title, 'clientWidth', 'get').mockReturnValue(60);
  vi.spyOn(title, 'scrollWidth', 'get').mockImplementation(() => width);
  const trigger = container.querySelector<HTMLButtonElement>('button');
  expect(trigger).not.toBeNull();
  trigger?.focus();
  expect(screen.queryByRole('tooltip')).toBeNull();
  trigger?.blur();
  width = 100;
  trigger?.focus();
  expect(screen.getByRole('tooltip').textContent).toContain(
    'Conversation name'
  );
  trigger?.blur();
  width = 40;
  trigger?.focus();
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(title.classList.contains('font-normal')).toBe(true);
});
