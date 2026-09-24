import type { MobileNavViewId } from '@components/app/mobile/mobile-nav-views';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { createSignal, onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  mountComposer: vi.fn(),
  unmountComposer: vi.fn(),
  view: 'mail' as MobileNavViewId | undefined,
  createItem: vi.fn(),
  createMenu: vi.fn(),
  openEvent: vi.fn(),
  openCompany: vi.fn(),
}));

import { TOKENS } from '@core/hotkey/tokens';

vi.mock('@app/features/command/Launcher', () => ({
  setCreateMenuOpen: mocks.createMenu,
  useCreateMenuBlocks: () => () =>
    ['Message', 'Email', 'Document', 'Task', 'Agent'].map((label) => ({
      label,
      hotkeyToken: (
        {
          Message: TOKENS.create.message,
          Email: TOKENS.create.email,
          Document: TOKENS.create.note,
          Task: TOKENS.create.task,
          Agent: TOKENS.create.agent,
        } as Record<string, string>
      )[label],
      keyDownHandler: () => mocks.createItem(label),
    })),
}));
vi.mock(
  '@app/features/calendar-view/components/use-open-event-composer',
  () => ({
    useOpenEventComposer: () => mocks.openEvent,
  })
);
vi.mock('@app/features/calendar/hooks/use-calendar-ui-flag', () => ({
  useCalendarUiFlag: () => () => true,
}));
vi.mock('@app/features/companies/CreateCompanyModal', () => ({
  openCreateCompanyModal: mocks.openCompany,
}));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@components/app/mobile/use-mobile-nav', () => ({
  useForegroundMobileView: () => () => mocks.view,
  useMobileNavNavigate: () => vi.fn(),
}));
vi.mock('@components/app/mobile/mobile-dock-views', () => ({
  useMobileDockViews: () => () => [],
}));
vi.mock('@components/app/mobile/PillTabs', () => ({
  PillTabs: () => <div role="tablist" aria-label="Search scopes" />,
}));
vi.mock('@components/app/mobile/MobileDockIsland', () => ({
  MobileDockIsland: (props: { children: import('solid-js').JSX.Element }) => (
    <div>{props.children}</div>
  ),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanel: () => undefined,
}));
vi.mock('@app/features/chat/SoupChatInput', () => ({
  SoupChatInput: () => {
    mocks.mountComposer();
    onCleanup(mocks.unmountComposer);
    return (
      <div>
        <textarea aria-label="Chat draft" />
        <button onClick={mocks.send}>Send</button>
      </div>
    );
  },
}));

import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import type { CreatableBlock } from '@app/features/command/types';
import { mountGlobalFocusListener } from '@app/signal/focus';
import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { MobileViewsRow } from '@components/app/mobile/MobileViewsRow';
import { mobilePageCreateBlock } from '@components/app/mobile/mobile-page-create-action';
import { setVirtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { MobilePageActionRow } from './MobilePageActionRow';

let mount: HTMLDivElement;
afterEach(() => {
  cleanup();
  mount.remove();
  setVirtualKeyboardVisible(false);
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.view = 'mail';
  setVirtualKeyboardVisible(false);
  SearchState.close();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // jsdom reports an empty animation name; browsers report `none`. Let
  // Kobalte finish dismissal here; actual motion is checked in the browser.
  const getComputedStyle = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = getComputedStyle(element);
    if (!style.animationName) {
      Object.defineProperty(style, 'animationName', { value: 'none' });
    }
    return style;
  });
  mount = document.createElement('div');
  document.body.append(mount);
  FloatRegions.setMount('accessory', mount);
  render(() => {
    mountGlobalFocusListener();
    return null;
  });
});

describe('Mobile page action row', () => {
  it.each(['input', 'textarea', 'contenteditable'] as const)(
    'hides while an outside %s is focused and preserves the AI draft',
    (kind) => {
      render(() => <MobilePageActionRow />);
      const draft = screen.getByRole('textbox', {
        name: 'Chat draft',
      }) as HTMLTextAreaElement;
      draft.value = 'Keep this draft';
      draft.focus();
      setVirtualKeyboardVisible(true);
      expect(screen.getByRole('textbox', { name: 'Chat draft' })).toBe(draft);

      const external = document.createElement(
        kind === 'contenteditable' ? 'div' : kind
      );
      if (kind === 'contenteditable') {
        external.setAttribute('contenteditable', 'true');
        external.tabIndex = 0;
      }
      document.body.append(external);
      external.focus();
      expect(document.activeElement).toBe(external);
      expect(screen.queryByRole('textbox', { name: 'Chat draft' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
      // Focus also hides the bar with a hardware keyboard or before the virtual
      // keyboard visibility signal arrives.
      setVirtualKeyboardVisible(false);
      expect(screen.queryByRole('textbox', { name: 'Chat draft' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'New email' })).toBeNull();

      external.blur();
      external.remove();
      expect(screen.getByRole('textbox', { name: 'Chat draft' })).toBe(draft);
      expect(draft.value).toBe('Keep this draft');
      draft.focus();
      expect(document.activeElement).toBe(draft);
      expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
      expect(mocks.mountComposer).toHaveBeenCalledOnce();
      expect(mocks.unmountComposer).not.toHaveBeenCalled();
    }
  );

  it('starts hidden when another field is already focused and returns for a non-editable control', () => {
    render(() => (
      <>
        <input aria-label="Email subject" />
        <button type="button">Email options</button>
      </>
    ));
    screen.getByRole('textbox', { name: 'Email subject' }).focus();
    render(() => <MobilePageActionRow />);
    expect(screen.queryByRole('textbox', { name: 'Chat draft' })).toBeNull();
    screen.getByRole('button', { name: 'Email options' }).focus();
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toBeTruthy();
    expect(mocks.mountComposer).toHaveBeenCalledOnce();
  });

  it('starts compact and yields to screen-specific controls, then returns', () => {
    const page = render(() => <MobilePageActionRow />);
    const draft = screen.getByRole('textbox', { name: 'Chat draft' });
    fireEvent.input(draft, { target: { value: 'Keep this draft' } });
    expect(screen.getByRole('button', { name: 'New email' })).toBeTruthy();
    const reply = render(() => (
      <FloatRegion region="accessory">
        <button>Reply</button>
      </FloatRegion>
    ));
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New email' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reply' })).toBeTruthy();
    reply.unmount();
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toBe(draft);
    expect((draft as HTMLTextAreaElement).value).toBe('Keep this draft');
    expect(mocks.mountComposer).toHaveBeenCalledOnce();
    expect(mocks.unmountComposer).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New email' })).toBeTruthy();
    page.unmount();
    expect(mocks.unmountComposer).toHaveBeenCalledOnce();
  });
  it('lets search take precedence over a document composer, then restores the available accessory', () => {
    const [canComment, setCanComment] = createSignal(true);
    // Mount the fallback last to ensure priority, rather than mount order, wins.
    render(() => (
      <>
        <MobileViewsRow />
        <FloatRegion region="accessory" active={canComment}>
          <button>Leave a comment</button>
        </FloatRegion>
        <MobilePageActionRow />
      </>
    ));
    expect(
      screen.getByRole('button', { name: 'Leave a comment' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();

    SearchState.open();
    expect(screen.getByRole('tablist', { name: 'Search scopes' })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Leave a comment' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New email' })).toBeNull();

    SearchState.close();
    expect(
      screen.getByRole('button', { name: 'Leave a comment' })
    ).toBeTruthy();
    setCanComment(false);
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New email' })).toBeTruthy();

    SearchState.open();
    expect(screen.getByRole('tablist', { name: 'Search scopes' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    SearchState.close();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
    setCanComment(true);
    expect(
      screen.getByRole('button', { name: 'Leave a comment' })
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });
  it('replaces the Agents floating create button without removing other page actions', () => {
    const blocks: CreatableBlock[] = [
      {
        label: 'Mail draft',
        description: 'Create email',
        blockName: 'email',
        hotkeyToken: TOKENS.create.email,
        hotkey: 'e',
        keyDownHandler: vi.fn(() => true),
      },
      {
        label: 'Task',
        description: 'Create task',
        blockName: 'task',
        hotkeyToken: TOKENS.create.task,
        hotkey: 't',
        keyDownHandler: vi.fn(() => true),
      },
    ];

    expect(mobilePageCreateBlock('agents', blocks)).toBeUndefined();
    expect(mobilePageCreateBlock('mail', blocks)).toBe(blocks[0]);
    expect(mobilePageCreateBlock('tasks', blocks)).toBe(blocks[1]);
    expect(mobilePageCreateBlock('mail', [])).toBeUndefined();
  });
  it.each([
    ['mail', 'Email'],
    ['tasks', 'Task'],
    ['documents', 'Document'],
    ['channels', 'Message'],
  ] as const)('keeps New on %s alongside the AI composer', (view, label) => {
    mocks.view = view;
    render(() => <MobilePageActionRow />);
    const createButton = screen.getByRole('button', {
      name: `New ${label.toLowerCase()}`,
    });
    expect(createButton.textContent).toBe(label);
    fireEvent.click(createButton);
    expect(mocks.createItem).toHaveBeenCalledWith(label);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });
  it('shows only the AI composer on Agents, without a redundant create button', () => {
    mocks.view = 'agents';
    render(() => <MobilePageActionRow />);
    expect(screen.queryByRole('button', { name: /^New/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });
  it('opens company creation from CRM alongside the AI composer', () => {
    mocks.view = 'companies';
    render(() => <MobilePageActionRow />);
    const createButton = screen.getByRole('button', { name: 'New company' });
    expect(createButton.textContent).toBe('Company');
    fireEvent.click(createButton);
    expect(mocks.openCompany).toHaveBeenCalledOnce();
    expect(mocks.createMenu).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });
  it('opens the event composer from the calendar New button', () => {
    mocks.view = 'calendar';
    render(() => <MobilePageActionRow />);
    const createButton = screen.getByRole('button', { name: 'New event' });
    expect(createButton.textContent).toBe('Event');
    fireEvent.click(createButton);
    expect(mocks.openEvent).toHaveBeenCalledOnce();
  });
  it('opens the create menu on views without a specific New action', () => {
    mocks.view = undefined;
    render(() => <MobilePageActionRow />);
    fireEvent.click(screen.getByRole('button', { name: 'New' }));
    expect(mocks.createMenu).toHaveBeenCalledWith(true);
  });
  it('opens Home’s quick create actions in the requested order and restores focus on dismissal', async () => {
    mocks.view = 'inbox';
    render(() => <MobilePageActionRow />);
    const trigger = screen.getByRole('button', { name: 'New' });
    expect(screen.queryByRole('button', { name: 'New message' })).toBeNull();
    fireEvent.click(trigger);
    const menu = await screen.findByRole('dialog', { name: 'Create new' });
    expect(
      within(menu)
        .getAllByRole('button')
        .map((item) => item.textContent)
    ).toEqual(['Email', 'Message', 'Document', 'Event', 'Task', 'More', 'New']);
    fireEvent.click(
      within(menu).getByRole('button', { name: 'Close create menu' })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(mocks.createItem).not.toHaveBeenCalled();
  });
  it.each(['Email', 'Message', 'Document', 'Event', 'Task', 'More'])(
    'hands off Home’s %s action after closing the quick menu',
    async (label) => {
      mocks.view = 'inbox';
      render(() => <MobilePageActionRow />);
      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      const menu = await screen.findByRole('dialog', { name: 'Create new' });
      fireEvent.click(within(menu).getByRole('button', { name: label }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => {
        if (label === 'More')
          expect(mocks.createMenu).toHaveBeenCalledWith(true);
        else if (label === 'Event')
          expect(mocks.openEvent).toHaveBeenCalledOnce();
        else expect(mocks.createItem).toHaveBeenCalledWith(label);
      });
      expect(mocks.send).not.toHaveBeenCalled();
    }
  );
  it('hides only the page action while the keyboard is visible', () => {
    render(() => <MobilePageActionRow />);
    const draft = screen.getByRole('textbox', { name: 'Chat draft' });
    setVirtualKeyboardVisible(true);
    expect(screen.queryByRole('button', { name: 'New email' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Chat draft' })).toBe(draft);
    setVirtualKeyboardVisible(false);
    expect(screen.getByRole('button', { name: 'New email' })).toBeTruthy();
    expect(mocks.mountComposer).toHaveBeenCalledOnce();
  });
});
