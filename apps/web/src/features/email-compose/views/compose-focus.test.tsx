import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCompose } from '../context/compose-context';
import { createComposeContext } from '../tests/capabilities';
import { createEmailEditor, setEmailEditorText } from '../tests/editor';
import { EmailComposeView } from './email-compose';

vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: () => null,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  SplitHeaderBadge: () => null,
  StaticSplitLabel: () => null,
}));
vi.mock('@core/mobile/WrapUnlessMobile', () => ({
  WrapUnlessMobile: (props: ParentProps) => props.children,
}));
vi.mock('@core/hotkey/hotkeys', () => ({
  registerHotkey: vi.fn(),
  useHotkeyDOMScope: () => [vi.fn(), 'compose-email'],
}));
vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'me@example.com',
  useUserId: () => () => 'macro|me@example.com',
}));
vi.mock('@core/user/dmActivity', () => ({
  useAugmentUserWithDmActivity: () => (user: unknown) => user,
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element }) => <>{props.trigger}</>,
}));
vi.mock('@core/component/UserIcon', () => ({ UserIcon: () => null }));
vi.mock('virtua/solid', async () => {
  const { For } = await import('solid-js');
  return {
    VList: (props: {
      data: unknown[];
      children: (item: unknown) => JSX.Element;
    }) => <For each={props.data}>{props.children}</For>,
  };
});
vi.mock('../components/signature-preview', () => ({
  SignaturePreview: () => null,
}));
vi.mock('../components/email-schedule-summary', () => ({
  EmailScheduleBar: () => null,
}));
vi.mock('./compose-toolbar', () => ({ EmailComposeToolbar: () => null }));
// The rich text editor is out of scope; the body only needs to take typing.
vi.mock('./compose-body', () => ({
  ComposeBody: () => {
    const state = useCompose();
    const editor = createEmailEditor();
    state.captureEditor(editor);
    state.onContentChange('');
    return (
      <textarea
        aria-label="Message"
        onInput={(event) => {
          setEmailEditorText(editor, event.currentTarget.value);
          state.onContentChange(event.currentTarget.value);
        }}
      />
    );
  },
}));

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const providers = ['GMAIL', 'OUTLOOK'] as const;

function openCompose(provider: (typeof providers)[number]) {
  const context = createComposeContext();
  context.accounts.inboxes = () => [
    { id: 'inbox', email_address: 'me@example.com', provider, settings: {} },
  ];
  render(() => <EmailComposeView context={context} />);
  return {
    to: screen.getByRole<HTMLInputElement>('combobox'),
    subject: screen.getByPlaceholderText<HTMLInputElement>('Subject'),
    message: screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Message',
    }),
  };
}

// A busy main thread runs queued input before the composer's deferred
// mount work.
const runDeferredMountWork = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

it.each(providers)(
  'keeps typing in the subject the user reached before To took focus (%s)',
  async (provider) => {
    const user = userEvent.setup({ delay: null });
    const compose = openCompose(provider);

    await user.click(compose.subject);
    await user.keyboard('Quarterly');
    await runDeferredMountWork();
    await user.keyboard(' plan');

    expect(compose.to.value).toBe('');
    expect(compose.subject.value).toBe('Quarterly plan');
    expect(document.activeElement).toBe(compose.subject);
  }
);

it.each(providers)(
  'keeps typing in the message the user reached before To took focus (%s)',
  async (provider) => {
    const user = userEvent.setup({ delay: null });
    const compose = openCompose(provider);

    await user.click(compose.message);
    await user.keyboard('Hello');
    await runDeferredMountWork();
    await user.keyboard(' there');

    expect(compose.to.value).toBe('');
    expect(compose.message.value).toBe('Hello there');
  }
);

it.each(providers)(
  'focuses To when a new compose opens (%s)',
  async (provider) => {
    const user = userEvent.setup({ delay: null });
    const compose = openCompose(provider);

    await runDeferredMountWork();
    await user.keyboard('colleague');

    expect(document.activeElement).toBe(compose.to);
    expect(compose.to.value).toBe('colleague');
  }
);
