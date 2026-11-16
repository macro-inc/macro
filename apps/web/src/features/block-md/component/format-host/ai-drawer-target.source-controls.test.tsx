/** @vitest-environment jsdom */
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { $getId } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { $createParagraphNode, $createTextNode, $getRoot } from 'lexical';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MarkdownDocumentProvider } from '../../context/markdown-document-context';
import { createMarkdownDocumentState } from '../../context/markdown-document-state';
import { desktopBodyFormatPopup } from '../../views/body-format-popup';

// Source control for the touch AI drawer's target: the real MarkdownPopup on a
// touch device. Select the first paragraph, tap "Edit with AI", then either
// (A) the drawer textarea takes focus and the editor selection is lost, or
// (B) the editor selection moves to the second paragraph; submit and read the
// node ids Source sends. The native AI slot's matching tests are in
// native-ai-edit-slot.test.tsx.

const service = vi.hoisted(() => ({ prompts: [] as string[] }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/context/user', () => ({
  // Task visibility only.
  useUserId: () => () => undefined,
}));
vi.mock('../../queries/ai-edit', () => ({
  requestAiEditWithToast: (args: { prompt: string }) => {
    service.prompts.push(args.prompt);
    return new Promise<void>(() => {});
  },
  cancelAiEdit: () => {},
  hasActiveAiEdit: () => false,
}));
vi.mock('@app/lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/analytics/posthog')>()),
  // The inline-ai-editing flag, on.
  useFeatureFlag: () => () => ({
    enabled: true,
    payload: undefined,
    loading: false,
  }),
}));

const { MarkdownPopup } = await import('../MarkdownPopup');

const rangeLayout = ['getBoundingClientRect', 'getClientRects'] as const;
const originalRangeLayout = rangeLayout.map(
  (name) =>
    [name, Object.getOwnPropertyDescriptor(Range.prototype, name)] as const
);
const offsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetWidth'
);
const owned: (() => void)[] = [];

beforeEach(() => {
  service.prompts.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('innerWidth', 4000);
  const box = () => DOMRect.fromRect({ x: 10, y: 10, width: 80, height: 16 });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: box,
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [box()],
  });
  // jsdom has no layout: every touch option measures one width.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 40,
  });
});
afterEach(() => {
  const failures: unknown[] = [];
  const attempt = (release: () => void) => {
    try {
      release();
    } catch (error) {
      failures.push(error);
    }
  };
  attempt(cleanup);
  for (const release of owned.splice(0).reverse()) attempt(release);
  attempt(() => document.body.replaceChildren());
  for (const [name, descriptor] of originalRangeLayout)
    attempt(() => {
      if (descriptor) Object.defineProperty(Range.prototype, name, descriptor);
      else Reflect.deleteProperty(Range.prototype, name);
    });
  attempt(() => {
    if (offsetWidth)
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth);
    else Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
  });
  attempt(() => {
    vi.unstubAllGlobals();
  });
  if (failures.length > 0) throw failures[0];
});

function mount() {
  const { wrapper, state } = createRoot((dispose) => {
    owned.push(dispose);
    const created = createLexicalWrapper({
      type: 'markdown-sync',
      namespace: 'ai-drawer-target-source',
      withIds: true,
      isInteractable: () => true,
    });
    owned.push(() => created.cleanup());
    return { wrapper: created, state: createMarkdownDocumentState() };
  });
  const body = document.createElement('div');
  body.contentEditable = 'true';
  const highlights = document.createElement('div');
  const scope = document.createElement('div');
  scope.className = 'portal-scope';
  scope.dataset.blockContent = '';
  scope.append(body, highlights);
  document.body.append(scope);
  render(() => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <MarkdownDocumentProvider
          context={{
            documentId: () => 'ai-drawer-target-source',
            kind: () => 'document',
            documentSource: () => ({ type: 'loading' }),
            permissions: {
              canEdit: () => true,
              canComment: () => false,
              isOwner: () => true,
            },
            persistedName: () => undefined,
            fallbackName: () => undefined,
            bodyFormatPopup: () => desktopBodyFormatPopup,
            state,
            element: () => body,
          }}
        >
          <LexicalWrapperContext.Provider value={wrapper}>
            <FloatingMenuGroup>
              <MarkdownPopup
                highlightLayerRef={highlights}
                lexicalMapping={wrapper.mapping}
              />
            </FloatingMenuGroup>
          </LexicalWrapperContext.Provider>
        </MarkdownDocumentProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ));
  wrapper.editor.setRootElement(body);
  owned.push(() => wrapper.editor.setRootElement(null));
  wrapper.editor.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append($createTextNode('Alpha beta gamma')),
          $createParagraphNode().append($createTextNode('Second line'))
        );
    },
    { discrete: true }
  );
  const ids = wrapper.editor.read(() =>
    $getRoot()
      .getChildren()
      .map((node) => $getId(node))
  );
  const select = (paragraph: number, to: number) => {
    const text = body.querySelectorAll('[data-lexical-text]')[paragraph]
      ?.firstChild;
    if (!text) throw new Error('Missing rendered text');
    document.getSelection()?.setBaseAndExtent(text, 0, text, to);
    document.dispatchEvent(new Event('selectionchange'));
  };
  return { ids, select, body };
}

async function tapEditWithAi() {
  const option = await waitFor(() =>
    screen
      .getAllByRole('button', { name: 'Edit with AI' })
      .find((button) => !button.closest('[aria-hidden="true"], [inert]'))
  );
  if (!option) throw new Error('Missing Edit with AI option');
  fireEvent.click(option);
  return waitFor(() => screen.getByPlaceholderText('Describe changes'));
}

function submit(textarea: HTMLElement) {
  fireEvent.input(textarea, { target: { value: 'tighten this' } });
  fireEvent.keyDown(textarea, { key: 'Enter' });
}

test('Source control (A): the drawer submits the tap selection after the editor selection is lost', async () => {
  const { ids, select } = mount();
  select(0, 5);
  const textarea = await tapEditWithAi();
  // The drawer textarea takes focus; the DOM selection leaves the editor.
  textarea.focus();
  document.getSelection()?.removeAllRanges();
  document.dispatchEvent(new Event('selectionchange'));
  submit(textarea);
  expect(service.prompts).toEqual([
    `Request: tighten this\nUser is selecting nodes ${ids[0]}. Proceed with requested edit`,
  ]);
});

test('Source control (B): after the tap, an editor selection change at the same generation', async () => {
  const { ids, select } = mount();
  select(0, 5);
  const textarea = await tapEditWithAi();
  select(1, 6);
  submit(textarea);
  // Recorded, not assumed: which paragraph Source sends.
  expect(service.prompts).toHaveLength(1);
  expect(
    [ids[0], ids[1]].map((id) => service.prompts[0].includes(` ${id}.`))
  ).toEqual([false, true]);
});
