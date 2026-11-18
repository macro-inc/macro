/** @vitest-environment jsdom */
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { createInlineMenuTriggerListener } from '@core/component/LexicalMarkdown/shared/registerInlineMenuTrigger';
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

// Source control for the touch Paste with typeahead triggers: the real
// MarkdownPopup touch toolbar's Paste (iOS native edit menu present, the
// pasteboard mocked) inserts the text raw (insertRawText). For '/', '@' and
// ':smile:' it records the resulting text and whether any inline-menu trigger
// fires: every Source inline menu opens only through registerInlineMenuTrigger
// (actions '/', mentions '@', emojis ':'), attached here as those menus attach
// it. The native rows in native-touch-actions.test.ts must equal these.

const service = vi.hoisted(() => ({ prompts: [] as string[], pasteboard: '' }));
vi.mock('@core/mobile/nativeEditMenu', () => ({
  hasNativeEditMenu: () => true,
  readNativePasteboardText: async () => service.pasteboard,
  setNativeEditMenuSuppressed: () => {},
}));
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
      namespace: 'paste-typeahead-source',
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
            documentId: () => 'paste-typeahead-source',
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
        .append($createParagraphNode().append($createTextNode('Alpha beta')));
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
  const text = () => wrapper.editor.read(() => $getRoot().getTextContent());
  return { ids, select, body, text };
}

export const PASTE_TYPEAHEAD_ROWS = [
  ['/table', '/table beta'],
  ['@someone', '@someone beta'],
  [':smile:', ':smile: beta'],
] as const;

for (const [pasted, expected] of PASTE_TYPEAHEAD_ROWS) {
  test(`Source control: touch Paste of '${pasted}' is literal and opens no inline menu`, async () => {
    const { select, body, text } = mount();
    const triggers: string[] = [];
    for (const symbol of ['/', '@', ':'])
      createInlineMenuTriggerListener(symbol, () => triggers.push(symbol))(
        body,
        null
      );
    service.pasteboard = pasted;
    select(0, 5);
    const paste = await waitFor(() =>
      screen
        .getAllByRole('button', { name: 'Paste' })
        .find((button) => !button.closest('[aria-hidden="true"], [inert]'))
    );
    if (!paste) throw new Error('Missing Paste option');
    fireEvent.click(paste);
    await waitFor(() => expect(text()).toBe(expected));
    expect(triggers).toEqual([]);
  });
}
