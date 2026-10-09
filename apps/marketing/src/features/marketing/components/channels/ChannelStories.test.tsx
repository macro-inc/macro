import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ChannelAgentDemo,
  ChannelPermissionsDemo,
  ChannelSharedWorkDemo,
  ChannelThreadDemo,
} from './ChannelStories';
import { ChannelWorkSurface } from './ChannelWorkSurface';
import {
  CHANNEL_DOC,
  CHANNEL_EMAIL,
  CHANNEL_TASK,
  createChannelProject,
  FOLLOW_UP_TASK,
} from './channelProject';

let intersections: IntersectionObserverCallback[];
let motionListeners: (() => void)[];
let reduced = false;
let hidden = false;
beforeEach(() => {
  intersections = [];
  motionListeners = [];
  reduced = false;
  hidden = false;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, callback: () => void) =>
      motionListeners.push(callback),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersections.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.advanceTimersByTime(100);
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function visible(value: boolean) {
  for (const callback of intersections)
    callback(
      [{ isIntersecting: value } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
}
function reduce() {
  reduced = true;
  for (const callback of motionListeners) callback();
}
it('shows the first replies inline and expands the rest from the pill', () => {
  const view = render(() => <ChannelThreadDemo />);
  const thread = view.container.querySelector(
    '[data-thread-id="root"]'
  ) as HTMLElement;
  expect(within(thread).getByText(/yep, 2pm/)).toBeTruthy();
  expect(within(thread).queryByText(/working from home/)).toBeNull();
  fireEvent.click(within(thread).getByText('2 more replies'));
  expect(within(thread).getByText(/working from home/)).toBeTruthy();
});

it('adds a reply to its original thread rather than a new channel message', () => {
  const view = render(() => <ChannelThreadDemo />);
  const thread = () =>
    view.container.querySelector('[data-thread-id="root"]') as HTMLElement;
  fireEvent.click(within(thread()).getByText('2 more replies'));
  fireEvent.click(
    within(thread()).getByRole('button', { name: 'Reply in thread' })
  );
  const input = within(thread()).getByRole('textbox', {
    name: 'Thread reply',
  });
  input.textContent = 'see you then';
  fireEvent.input(input);
  fireEvent.click(
    within(thread()).getByRole('button', { name: 'Send demo message' })
  );
  expect(within(thread()).getByText('see you then')).toBeTruthy();
  expect(
    view.container.querySelectorAll('.sample-channel-thread')
  ).toHaveLength(3);
});

it('shows multiple conversations without a navigation sidebar', () => {
  const view = render(() => <ChannelThreadDemo />);
  expect(view.queryByRole('complementary', { name: 'Home' })).toBeNull();
  expect(view.getByText('new icons are in the folder btw')).toBeTruthy();
  expect(view.getByText('much sharper. let’s use these')).toBeTruthy();
  expect(view.getByText('signup button is fixed on mobile now')).toBeTruthy();
  expect(
    view.container.querySelectorAll('.sample-channel-thread')
  ).toHaveLength(3);
  visible(true);
  vi.advanceTimersByTime(3000);
  expect(view.queryByText(/working from home/)).toBeNull();
  fireEvent.click(view.getByRole('button', { name: /2 more replies/ }));
  expect(view.getByText(/working from home/)).toBeTruthy();
});

it('shows channel access in Share and retains the chosen permission after reopening', () => {
  const view = render(() => <ChannelPermissionsDemo />);
  visible(true);
  vi.advanceTimersByTime(1300);
  const access = view.getByRole('combobox', {
    name: 'Access for Julia, Teo, Gabriel +1 other',
  });
  expect((access as HTMLSelectElement).value).toBe('view');
  fireEvent.change(access, { target: { value: 'comment' } });
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  expect(
    (
      view.getByRole('combobox', {
        name: 'Access for Julia, Teo, Gabriel +1 other',
      }) as HTMLSelectElement
    ).value
  ).toBe('comment');
});

it('shows the completed email split for reduced motion', () => {
  reduced = true;
  const view = render(() => <ChannelSharedWorkDemo />);
  expect(
    within(view.getByRole('region', { name: 'Shared work' })).getByText(
      /signup button is still hard to tap/
    )
  ).toBeTruthy();
});

it('turns a message into a task assigned to the person who offered', () => {
  const view = render(() => <ChannelAgentDemo />);
  expect(view.queryByRole('button', { name: FOLLOW_UP_TASK })).toBeNull();
  visible(true);
  vi.advanceTimersByTime(1700);
  expect(view.getByRole('button', { name: FOLLOW_UP_TASK })).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: FOLLOW_UP_TASK }));
  const work = within(view.getByRole('region', { name: 'Shared work' }));
  expect(work.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    FOLLOW_UP_TASK
  );
  expect(
    work.getByRole('textbox', { name: 'Task description' }).textContent
  ).toContain('easier to tap on a phone');
  for (const assignee of work.getAllByRole('button', {
    name: 'Change assignee',
  }))
    expect(assignee.textContent).toContain('Julia');
  expect(work.getByRole('button', { name: 'From launch' })).toBeTruthy();
});

it('shows one agent-created task when motion preference changes', () => {
  const view = render(() => <ChannelAgentDemo />);
  visible(true);
  vi.advanceTimersByTime(1700);
  reduce();
  expect(view.getAllByRole('button', { name: FOLLOW_UP_TASK })).toHaveLength(1);
});

it('opens shared work, preserves document edits, and returns keyboard focus to the link', async () => {
  const view = render(() => <ChannelSharedWorkDemo />);
  const docLink = view.getByRole('button', { name: 'Launch checklist' });
  docLink.focus();
  fireEvent.pointerDown(docLink);
  fireEvent.click(docLink);
  await Promise.resolve();
  expect(document.activeElement).toBe(
    view.getByRole('button', { name: 'Close shared work' })
  );
  const title = view.getByRole('textbox', { name: 'Document title' });
  title.innerText = 'Launch checklist — reviewed';
  fireEvent.blur(title);
  fireEvent.keyDown(view.getByRole('region', { name: 'Shared work' }), {
    key: 'Escape',
  });
  await Promise.resolve();
  expect(document.activeElement).toBe(docLink);
  fireEvent.click(
    view.getByRole('button', { name: 'Launch checklist — reviewed' })
  );
  expect(
    view.getByRole('textbox', { name: 'Document title' }).textContent
  ).toBe('Launch checklist — reviewed');
  fireEvent.click(view.getByRole('button', { name: 'Close shared work' }));
  vi.advanceTimersByTime(15000);
  expect(
    view.getByRole('button', { name: 'Launch checklist — reviewed' })
  ).toBeTruthy();
});

it('dismisses a task menu with Escape without closing the shared task', () => {
  reduced = true;
  const view = render(() => <ChannelAgentDemo />);
  fireEvent.click(view.getByRole('button', { name: FOLLOW_UP_TASK }));
  const work = within(view.getByRole('region', { name: 'Shared work' }));
  const trigger = work
    .getAllByRole('button', { name: 'Change status' })
    .at(-1)!;
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  vi.advanceTimersByTime(1);
  fireEvent.keyDown(view.getByRole('menuitem', { name: 'Completed' }), {
    key: 'Escape',
  });
  expect(view.getByRole('region', { name: 'Shared work' })).toBeTruthy();
});

it('uses the chosen emoji, dismisses the toolbar, and toggles only that reaction', () => {
  const view = render(() => <ChannelSharedWorkDemo />);
  const row = view
    .getByRole('button', { name: 'Launch checklist' })
    .closest('article')!;
  fireEvent.click(within(row).getByRole('button', { name: 'React ❤️' }));
  expect(
    within(row)
      .getByRole('button', { name: '❤️ 1' })
      .getAttribute('aria-pressed')
  ).toBe('true');
  expect(row.getAttribute('data-actions-dismissed')).toBe('true');
  fireEvent.pointerLeave(row);
  fireEvent.pointerEnter(row);
  expect(row.getAttribute('data-actions-dismissed')).toBe('false');
  fireEvent.click(within(row).getByRole('button', { name: 'React 😂' }));
  expect(within(row).getByRole('button', { name: '😂 1' })).toBeTruthy();
  fireEvent.click(within(row).getByRole('button', { name: '❤️ 1' }));
  expect(within(row).queryByRole('button', { name: '❤️ 1' })).toBeNull();
  expect(within(row).getByRole('button', { name: '😂 1' })).toBeTruthy();
});

it('renders docs, email, and tasks inside the message text without duplicate attachments', () => {
  const view = render(() => (
    <ChannelWorkSurface workspace={createChannelProject()} />
  ));
  for (const name of [CHANNEL_DOC, CHANNEL_EMAIL, CHANNEL_TASK]) {
    const mention = view.getByRole('button', { name });
    expect(mention.closest('p')).toBeTruthy();
    expect(view.getAllByRole('button', { name })).toHaveLength(1);
    expect(mention.classList.contains('dummy-entity-link')).toBe(false);
  }
  const email = view.getByRole('button', { name: CHANNEL_EMAIL });
  expect(email.closest('p')?.textContent).toContain(
    'did you catch the signup button'
  );
  fireEvent.click(email);
  expect(
    within(view.getByRole('region', { name: 'Shared work' })).getByText(
      /signup button is still hard to tap/
    )
  ).toBeTruthy();
});

it('opens email and tasks from the first feature demo and preserves manual navigation', () => {
  const view = render(() => <ChannelSharedWorkDemo />);
  const email = view.getByRole('button', { name: CHANNEL_EMAIL });
  fireEvent.pointerDown(email);
  fireEvent.click(email);
  expect(
    within(view.getByRole('region', { name: 'Shared work' })).getByText(
      /signup button is still hard to tap/
    )
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Close shared work' }));
  fireEvent.click(view.getByRole('button', { name: CHANNEL_TASK }));
  visible(true);
  vi.advanceTimersByTime(15000);
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    CHANNEL_TASK
  );
});

it('keeps scrollable history and visibly clicks the doc before switching the split to email', () => {
  const view = render(() => <ChannelSharedWorkDemo />);
  expect(
    view.getByText('anyone else getting the old logo on the preview?')
  ).toBeTruthy();
  expect(view.queryByRole('region', { name: 'Shared work' })).toBeNull();
  visible(true);
  vi.advanceTimersByTime(3600);
  expect(
    view.container.querySelector('.demo-cursor[data-clicking="true"]')
  ).toBeTruthy();
  expect(view.queryByRole('region', { name: 'Shared work' })).toBeNull();
  vi.advanceTimersByTime(400);
  expect(view.getByRole('textbox', { name: 'Document body' })).toBeTruthy();
  vi.advanceTimersByTime(6500);
  expect(
    within(view.getByRole('region', { name: 'Shared work' })).getByText(
      /signup button is still hard to tap/
    )
  ).toBeTruthy();
});

it('lets Julia bring Cursor into the same agent thread and keeps her task ownership', () => {
  const view = render(() => <ChannelAgentDemo />);
  visible(true);
  vi.advanceTimersByTime(5700);
  const thread = view.container.querySelector(
    '[data-thread-id="follow-up-request"]'
  ) as HTMLElement;
  expect(
    thread.querySelector('[data-demo-mention="cursor"]')?.textContent
  ).toBe('@Cursor');
  expect(
    thread
      .querySelector('[data-demo-mention="cursor"]')
      ?.classList.contains('mention-person')
  ).toBe(true);
  expect(within(thread).getByText(/thanks\./)).toBeTruthy();
  vi.advanceTimersByTime(3300);
  expect(within(thread).getByText(/Found a mobile style/)).toBeTruthy();
  expect(
    thread.querySelectorAll('.sample-agent-avatar[data-agent="cursor"]')
  ).toHaveLength(1);
  expect(within(thread).queryByText(/On it/)).toBeNull();
  fireEvent.click(view.getByRole('button', { name: FOLLOW_UP_TASK }));
  const work = within(view.getByRole('region', { name: 'Shared work' }));
  for (const status of work.getAllByRole('button', { name: 'Change status' }))
    expect(status.textContent).toContain('In Progress');
  for (const owner of work.getAllByRole('button', { name: 'Change assignee' }))
    expect(owner.textContent).toContain('Julia');
});

it('keeps document edits when email opens in a third split and closes only the selected pane', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1440);
  const view = render(() => <ChannelSharedWorkDemo />);
  const docLink = view.getByRole('button', { name: 'Launch checklist' });
  fireEvent.pointerDown(docLink);
  fireEvent.click(docLink);
  const documentPane = () =>
    view.container.querySelector('[data-pane-view="documents"]') as HTMLElement;
  const title = within(documentPane()).getByRole('textbox', {
    name: 'Document title',
  });
  title.innerText = 'Launch checklist reviewed';
  fireEvent.blur(title);
  fireEvent.click(view.getByRole('button', { name: CHANNEL_EMAIL }));
  expect(view.container.querySelectorAll('.channel-work-item')).toHaveLength(2);
  expect(
    within(documentPane()).getByRole('textbox', { name: 'Document title' })
      .textContent
  ).toBe('Launch checklist reviewed');
  const emailPane = view.container.querySelector(
    '[data-pane-view="email"]'
  ) as HTMLElement;
  expect(within(emailPane).getByText(/hard to tap/)).toBeTruthy();
  expect(
    within(emailPane).getByText(/We’ll fix the button before launch/)
  ).toBeTruthy();
  fireEvent.click(
    within(emailPane).getByRole('button', { name: 'Close shared work' })
  );
  await Promise.resolve();
  expect(view.container.querySelector('[data-pane-view="email"]')).toBeNull();
  expect(documentPane()).toBeTruthy();
  fireEvent.click(
    within(documentPane()).getByRole('button', { name: 'Close shared work' })
  );
  await Promise.resolve();
  expect(view.container.querySelectorAll('.channel-work-item')).toHaveLength(0);
});
