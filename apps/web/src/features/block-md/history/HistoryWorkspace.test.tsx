import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HistoryWorkspace } from './HistoryWorkspace';

const mocks = vi.hoisted(() => ({
  mobile: false,
  history: {} as Record<string, unknown>,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@core/constant/featureFlags', () => ({
  enableHistoryComponent: {},
  isFeatureEnabled: () => true,
}));
vi.mock('@core/component/LexicalMarkdown/utils', () => ({
  getSaveState: (state: unknown) => state,
}));
vi.mock('@core/component/ParamsProvider', () => ({
  ParamsProvider: (props: ParentProps) => props.children,
}));
vi.mock('@ui', () => ({
  Scroll: (props: ParentProps) => <div>{props.children}</div>,
}));
vi.mock('../component/MarkdownNameProvider', () => ({
  useMarkdownName: () => ({ displayName: () => 'Document' }),
}));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    state: { editor: { md: {} }, params: {} },
    element: () => undefined,
  }),
}));
vi.mock('./HistoryContext', () => ({ useHistory: () => mocks.history }));
vi.mock('./HistoryOverlay', () => ({
  HistoryOverlay: () => <p>Read-only version</p>,
}));
vi.mock('./HistoryScrubber', () => ({
  HistoryScrubber: () => <div>History graph</div>,
}));
vi.mock('./HistorySessionList', () => ({
  HistorySessionList: () => <div>History sessions</div>,
}));
vi.mock('./HistoryToolbar', () => ({
  HistoryToolbar: (props: { onClose: () => void }) => (
    <button onClick={props.onClose}>Close history</button>
  ),
}));

beforeEach(() => {
  mocks.mobile = false;
});
afterEach(cleanup);

function setup(
  options: { loading?: boolean; error?: string; sessions?: boolean } = {}
) {
  let setOpen!: (open: boolean) => void;
  const exit = vi.fn(() => setOpen(false));
  const mounted = vi.fn();
  const Editor = () => {
    mounted();
    return <textarea aria-label="Live editor" />;
  };
  render(() => {
    const [open, updateOpen] = createSignal(false);
    setOpen = updateOpen;
    mocks.history = {
      isOpen: open,
      exit,
      selectedAt: () => null,
      isLive: () => true,
      loading: { sessions: () => options.loading ?? false },
      error: () => options.error ?? null,
      sessions: () =>
        options.sessions === false ? [] : [{ startMs: 1, endMs: 2 }],
      diff: { session: () => null },
    };
    return (
      <HistoryWorkspace>
        <Editor />
      </HistoryWorkspace>
    );
  });
  return { setOpen, exit, mounted };
}

it('keeps the live editor mounted and preserves its draft through opening and Escape', async () => {
  const { setOpen, exit, mounted } = setup();
  const editor = screen.getByRole('textbox', {
    name: 'Live editor',
  }) as HTMLTextAreaElement;
  await fireEvent.input(editor, { target: { value: 'Unsaved draft' } });
  setOpen(true);
  expect(editor.parentElement?.inert).toBe(true);
  expect(
    screen.getByRole('region', { name: 'Version preview' }).textContent
  ).toContain('Read-only version');
  const timeline = screen.getByRole('complementary', {
    name: 'History timeline and sessions',
  });
  expect(timeline.textContent).toContain('History graph');
  expect(timeline.textContent).toContain('History sessions');
  await fireEvent.keyDown(
    screen.getByRole('button', { name: 'Close history' }),
    { key: 'Escape' }
  );
  expect(exit).toHaveBeenCalledOnce();
  expect(screen.queryByRole('region', { name: 'Document history' })).toBeNull();
  expect(editor.parentElement?.inert).toBe(false);
  expect(editor.value).toBe('Unsaved draft');
  setOpen(true);
  await fireEvent.click(screen.getByRole('button', { name: 'Close history' }));
  expect(mounted).toHaveBeenCalledOnce();
});

it('does not take over the document on mobile', () => {
  mocks.mobile = true;
  const { setOpen } = setup();
  setOpen(true);
  expect(screen.queryByRole('region', { name: 'Document history' })).toBeNull();
  expect(screen.getByRole('textbox').parentElement?.inert).toBe(false);
});

it('distinguishes a failed history request from an empty history', () => {
  const { setOpen } = setup({ error: 'Snapshot unavailable', sessions: false });
  setOpen(true);
  expect(screen.getByRole('alert').textContent).toContain(
    "Couldn't load history"
  );
  expect(screen.queryByText('No history yet')).toBeNull();
});
