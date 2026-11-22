/** @vitest-environment jsdom */
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
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
import { promptSlot } from './body-popup-slots';
import { NativeBodyToolbar } from './native-body-toolbar';

// C-TOOLBAR-NAME-01 (PM ruling: exact Source). Source MarkdownPopupToolbar
// renders its selection toolbar without an accessible name; the native body
// toolbar matches it, in both its toolbar and its prompt states.

vi.mock('@core/context/user', () => ({
  // Task visibility only; the toolbar's name does not depend on it.
  useUserId: () => () => undefined,
}));

const { MarkdownPopup } = await import('../MarkdownPopup');

// Range has no layout methods in jsdom; whatever is there is restored.
const rangeLayout = ['getBoundingClientRect', 'getClientRects'] as const;
const originalRangeLayout = rangeLayout.map(
  (name) =>
    [name, Object.getOwnPropertyDescriptor(Range.prototype, name)] as const
);
/** Releases for this test, run in reverse in afterEach. */
const owned: (() => void)[] = [];

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // jsdom has no layout: every range measures one fixed box.
  const box = () => DOMRect.fromRect({ x: 10, y: 10, width: 80, height: 16 });
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: box,
  });
  Object.defineProperty(Range.prototype, 'getClientRects', {
    configurable: true,
    value: () => [box()],
  });
});
afterEach(() => {
  // Every release is attempted even when an earlier one throws; the first
  // failure is rethrown after all of them ran.
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
  attempt(() => vi.unstubAllGlobals());
  if (failures.length > 0) throw failures[0];
});

test('Source control: the MarkdownPopup selection toolbar has no accessible name', async () => {
  // The real wrapper and document state, owned by a root disposed after.
  const { wrapper, state } = createRoot((dispose) => {
    owned.push(dispose);
    const created = createLexicalWrapper({
      type: 'markdown-sync',
      namespace: 'toolbar-name-source',
      withIds: true,
      isInteractable: () => true,
    });
    owned.push(() => created.cleanup());
    return { wrapper: created, state: createMarkdownDocumentState() };
  });
  const body = document.createElement('div');
  body.contentEditable = 'true';
  const highlights = document.createElement('div');
  // As the app mounts it: the body inside a block's portal scope.
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
            documentId: () => 'toolbar-name-source',
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
          $createParagraphNode().append($createTextNode('Select this phrase'))
        );
    },
    { discrete: true }
  );
  // A user selection: the DOM selection moves, then selectionchange fires.
  const text = body.querySelector('[data-lexical-text]')?.firstChild;
  if (!text) throw new Error('Missing rendered text');
  body.focus();
  document.getSelection()?.setBaseAndExtent(text, 0, text, 6);
  document.dispatchEvent(new Event('selectionchange'));
  const toolbar = await waitFor(() => screen.getByRole('toolbar'));
  // The Source toolbar is the real one: it carries the formatting controls.
  expect(screen.getByRole('button', { name: 'Bold' })).toBeTruthy();
  expect(toolbar.getAttribute('aria-label')).toBeNull();
  expect(toolbar.getAttribute('aria-labelledby')).toBeNull();
});

test('native: the body toolbar and its prompt have no accessible name, as Source', () => {
  render(() => (
    <NativeBodyToolbar
      slots={[
        promptSlot<undefined>({
          id: 'ai',
          available: () => true,
          button: (control) => (
            <button type="button" onClick={() => control.open()}>
              AI edit
            </button>
          ),
          capture: () => undefined,
          prompt: () => <textarea placeholder="Describe changes" />,
        }),
      ]}
      interactable={() => true}
      formatTools={() => null}
      hide={() => {}}
      focusEditor={() => {}}
    />
  ));
  const named = () => {
    const toolbar = screen.getByRole('toolbar');
    return [
      toolbar.getAttribute('aria-label'),
      toolbar.getAttribute('aria-labelledby'),
    ];
  };
  expect(named()).toEqual([null, null]);
  fireEvent.click(screen.getByText('AI edit'));
  expect(screen.getByPlaceholderText('Describe changes')).toBeTruthy();
  expect(named()).toEqual([null, null]);
});
