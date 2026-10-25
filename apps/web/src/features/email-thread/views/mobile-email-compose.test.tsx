import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { type ComponentProps, createSignal, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DraftBackMenu } from '../../email-compose/components/draft-back-menu';
import { MobileReplyToolbar } from '../../email-compose/components/mobile-reply-toolbar';
import { message } from '../tests/fixtures';
import { MobileEmailCompose } from './mobile-email-compose';
import type { ThreadReplyInput } from './thread-reply-input';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/mobile/haptics', () => ({ hapticImpact: vi.fn() }));
vi.mock('@core/component/FloatingInputLoader', () => ({
  FloatingInputLoader: () => null,
}));
vi.mock('../context/email-thread-state-context', () => ({
  useEmailThreadState: () => state,
}));

const [open, setOpen] = createSignal(false);
const [messageId, setMessageId] = createSignal<string>();
const [savedText, setSavedText] = createSignal('Saved reply');
const [fetching, setFetching] = createSignal(false);
const parent = message('parent');
const state = {
  mobileReplyComposer: {
    open,
    setOpen,
    messageId,
    close: () => {
      setOpen(false);
      setMessageId(undefined);
    },
  },
  permissions: () => ({ isOwner: true }),
  messages: { unfiltered: () => [parent], setBottomReplyOpen: vi.fn() },
  drafts: {
    getDraftForMessage: () =>
      message('draft', { is_draft: true, body_text: savedText() }),
  },
  query: {
    get isFetching() {
      return fetching();
    },
  },
};

// The shell owns full-screen presentation and close routing. The real draft
// controller/editor lifetime is covered by thread-reply-input and compose tests.
vi.mock('./thread-reply-input', () => ({
  ThreadReplyInput: (props: ComponentProps<typeof ThreadReplyInput>) => {
    const seed = props.draft?.body_text ?? '';
    const [menuOpen, setMenuOpen] = createSignal(false);
    const close = () => setMenuOpen(!menuOpen());
    onMount(() => props.mobileCompose?.registerClose(close));
    return (
      <>
        <MobileReplyToolbar
          onBack={close}
          attachRef={() => {}}
          onSend={() => props.setShowReply?.(false)}
          sendLabel="Send email"
          sendDisabled={false}
          sending={false}
          editingDisabled={false}
        />
        <label>
          Message
          <textarea
            value={seed}
            onInput={(event) => setSavedText(event.currentTarget.value)}
          />
        </label>
        <DraftBackMenu
          mount={props.mobileCompose?.portalMount()}
          open={menuOpen()}
          onOpenChange={setMenuOpen}
          onSave={async () => props.mobileCompose?.onClose()}
          onDelete={async () => {
            setSavedText('');
            props.mobileCompose?.onClose();
          }}
        />
      </>
    );
  },
}));

let motionStyles: HTMLStyleElement;
beforeEach(() => {
  motionStyles = document.createElement('style');
  motionStyles.textContent =
    '[data-corvu-drawer-content], [data-corvu-drawer-overlay] { transition-duration: 0s; animation-name: none; }';
  document.head.append(motionStyles);
  setOpen(false);
  setMessageId(undefined);
  setSavedText('Saved reply');
  setFetching(false);
  vi.stubGlobal('scrollTo', vi.fn());
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
  motionStyles.remove();
  vi.unstubAllGlobals();
});

function mount() {
  render(() => (
    <>
      <button
        onClick={() => {
          setMessageId('parent');
          setOpen(true);
        }}
      >
        Reply
      </button>
      <MobileEmailCompose />
    </>
  ));
}

it('opens at full screen, keeps the editor during refresh, and returns to the same draft', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  const composer = screen.getByRole('dialog', { name: 'Reply composer' });
  expect(composer.closest('[data-corvu-drawer-content]')).toBeNull();
  const input = screen.getByRole('textbox', { name: 'Message' });
  fireEvent.input(input, { target: { value: 'Reply in progress' } });
  setFetching(true);
  setFetching(false);
  expect(screen.getByRole('textbox', { name: 'Message' })).toBe(input);
  fireEvent.click(screen.getByRole('button', { name: 'Go Back' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(state.messages.setBottomReplyOpen).toHaveBeenCalledWith(false);
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  expect(
    (screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement)
      .value
  ).toBe('Reply in progress');
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('routes Escape to draft choices and dismisses those before the composer', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  const save = await screen.findByRole('button', { name: 'Save Draft' });
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Delete Draft' })
    )
  );
  fireEvent.keyDown(save, { key: 'Escape' });
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Save Draft' })).toBeNull()
  );
  expect(screen.getByRole('dialog', { name: 'Reply composer' })).toBeTruthy();
  fireEvent.keyDown(document, { key: 'Escape' });
  fireEvent.click(await screen.findByRole('button', { name: 'Save Draft' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
