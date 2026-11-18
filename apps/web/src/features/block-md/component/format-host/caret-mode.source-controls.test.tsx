/** @vitest-environment jsdom */
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { FloatingMenuGroup } from '@core/component/LexicalMarkdown/context/FloatingMenuContext';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { $getMarkIdsAtCaret } from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isTextNode,
  type LexicalNode,
} from 'lexical';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MarkdownDocumentProvider } from '../../context/markdown-document-context';
import { createMarkdownDocumentState } from '../../context/markdown-document-state';
import { desktopBodyFormatPopup } from '../../views/body-format-popup';

// Source control for C-TOUCH-CARET-MODE-01: the real MarkdownPopup on a touch
// device over a paragraph with a comment mark. Its popupPlugin admits an
// empty-text range only through $allowEmptySelection (popupPlugin.ts
// :190-195), which MarkdownPopup supplies as `$getMarkIdsAtCaret(anchor) !=
// null` on touch (:183-191); the toolbar's hasSelection is text emptiness
// (:849). The highlighted threads are test-owned state, as the comment plugin
// is not mounted here. Each row's facts are the native caret rows' expected
// values.

const device = vi.hoisted(() => ({ ios: false, suppressed: [] as boolean[] }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
vi.mock('@core/util/platform', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@core/util/platform')>();
  const platform = () => (device.ios ? 'ios' : actual.getPlatform());
  return {
    ...actual,
    getPlatform: platform,
    isPlatform: (target: Parameters<typeof actual.isPlatform>[0]) =>
      (Array.isArray(target) ? target : [target]).includes(platform()),
  };
});
vi.mock('@core/mobile/nativeEditMenu', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/mobile/nativeEditMenu')>()),
  setNativeEditMenuSuppressed: (suppressed: boolean) =>
    device.suppressed.push(suppressed),
}));
vi.mock('@core/context/user', () => ({
  // Task visibility only.
  useUserId: () => () => undefined,
}));
vi.mock('@app/lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/analytics/posthog')>()),
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

// Selection events are jsdom's own: Selection-impl _associateRange queues one
// "selectionchange" (setTimeout 0) per boundary change, which Lexical needs to
// clear its "change came from my DOM update" flag. Real timers throughout, so
// that queue runs; nothing here dispatches selectionchange.
let selectionChanges = 0;
const countSelectionChange = () => {
  selectionChanges += 1;
};
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Runs macrotasks until one passes with no new selectionchange, bounded. */
async function settle() {
  for (let turn = 0; turn < 20; turn += 1) {
    const before = selectionChanges;
    await macrotask();
    if (selectionChanges === before) return;
  }
  throw new Error('selectionchange did not settle in 20 macrotasks');
}

/** Waits, bounded, for the observed popup transition: the rendered toolbar
 *  (debouncedDependent, 100 ms lag) catching up with the popup's visible
 *  state, which the edit-menu suppression mirrors synchronously. */
async function popupSettled() {
  const deadline = Date.now() + 2000;
  while (toolbar().rendered !== toolbar().suppressed) {
    if (Date.now() > deadline)
      throw new Error(`popup did not settle: ${JSON.stringify(toolbar())}`);
    await macrotask();
  }
  await settle();
}

/** Delivers every queued selectionchange, releases the row's popup and editor,
 *  clears the selection and delivers that event too, so nothing queued by one
 *  row reaches the next. */
async function drain() {
  await settle();
  cleanup();
  for (const release of owned.splice(0).reverse()) release();
  document.body.replaceChildren();
  document.getSelection()?.removeAllRanges();
  await settle();
}

beforeEach(() => {
  selectionChanges = 0;
  document.addEventListener('selectionchange', countSelectionChange);
  device.ios = false;
  device.suppressed.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('innerWidth', 4000);
  const box = () => DOMRect.fromRect({ x: 10, y: 10, width: 0, height: 16 });
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
afterEach(async () => {
  const failures: unknown[] = [];
  const attempt = (release: () => void) => {
    try {
      release();
    } catch (error) {
      failures.push(error);
    }
  };
  try {
    await drain();
  } catch (error) {
    failures.push(error);
  }
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
  attempt(() =>
    document.removeEventListener('selectionchange', countSelectionChange)
  );
  if (failures.length > 0) throw failures[0];
});

const text = (value: string) => ({
  type: 'text',
  version: 1,
  text: value,
  detail: 0,
  format: 0,
  mode: 'normal',
  style: '',
});
const image = (id: string) => ({
  type: 'image',
  version: 1,
  srcType: 'url',
  id,
  url: `https://example.com/${id}.png`,
  alt: id,
  width: 40,
  height: 30,
  scale: 1,
});

/** The native caret rows' seed: "Before ", a comment mark (`ids`) around
 *  "marked" and an inline image, " after", then an inline image outside any
 *  comment. */
function seed(ids: string[]) {
  return JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children: [
        {
          type: 'paragraph',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          textStyle: '',
          children: [
            text('Before '),
            {
              type: 'comment-mark',
              version: 1,
              ids,
              isDraft: false,
              direction: null,
              format: '',
              indent: 0,
              children: [text('marked'), image('image-inside')],
            },
            text(' after'),
            image('image-outside'),
          ],
        },
      ],
    },
  });
}

function mount(options: {
  ids: string[];
  threads: string[];
  canEdit: boolean;
}) {
  const { wrapper, state } = createRoot((dispose) => {
    owned.push(dispose);
    const created = createLexicalWrapper({
      type: 'markdown-sync',
      namespace: 'caret-mode-source',
      withIds: true,
      isInteractable: () => options.canEdit,
    });
    owned.push(() => created.cleanup());
    return { wrapper: created, state: createMarkdownDocumentState() };
  });
  state.setCommentState('highlightedCommentThreads', options.threads);
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
            documentId: () => 'caret-mode-source',
            kind: () => 'document',
            documentSource: () => ({ type: 'loading' }),
            permissions: {
              canEdit: () => options.canEdit,
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
  wrapper.editor.setEditorState(
    wrapper.editor.parseEditorState(seed(options.ids))
  );
  return { editor: wrapper.editor, body };
}

/** Releases the previous row before the next mount. */
async function unmount() {
  await drain();
  device.suppressed.length = 0;
}

type Editor = ReturnType<typeof mount>['editor'];
type Body = ReturnType<typeof mount>['body'];

/** Places the DOM selection and lets Lexical read it, as a tap does. */
async function domSelect(
  body: Body,
  anchor: [Node, number],
  focus: [Node, number] = anchor
) {
  // Earlier selection writes (Lexical's own included) deliver their events.
  await settle();
  const before = selectionChanges;
  document.getSelection()?.setBaseAndExtent(...anchor, ...focus);
  await settle();
  // jsdom dispatched the tap's own event.
  expect(selectionChanges).toBeGreaterThan(before);
  expect(body.contains(document.getSelection()?.anchorNode ?? null)).toBe(true);
}

function renderedText(body: Body, value: string) {
  const span = [...body.querySelectorAll('[data-lexical-text]')].find(
    (candidate) => candidate.textContent === value
  );
  const node = span?.firstChild;
  if (!node) throw new Error(`Missing rendered text ${value}`);
  return node;
}

/** A caret at `offset` in the rendered text `value`. */
async function caret(body: Body, value: string, offset: number) {
  await domSelect(body, [renderedText(body, value), offset]);
}

/** A range over only one inline image: DOM element points around it. */
async function imageOnly(
  editor: Editor,
  body: Body,
  placement: 'inside' | 'outside'
) {
  const key = editor.read(() => {
    const paragraph = $getRoot().getFirstChildOrThrow();
    if (!$isElementNode(paragraph)) throw new Error('Missing paragraph');
    const images: LexicalNode[] = [];
    const walk = (node: LexicalNode) => {
      if (node.getType() === 'image') images.push(node);
      if ($isElementNode(node))
        for (const child of node.getChildren()) walk(child);
    };
    walk(paragraph);
    const found = images[placement === 'inside' ? 0 : 1];
    if (images.length !== 2 || !found) throw new Error('Expected two images');
    expect(found.getParentOrThrow().getType()).toBe(
      placement === 'inside' ? 'comment-mark' : 'paragraph'
    );
    return found.getKey();
  });
  const element = editor.getElementByKey(key);
  const parent = element?.parentNode;
  if (!element || !parent) throw new Error('Missing rendered image');
  const index = [...parent.childNodes].indexOf(element);
  await domSelect(body, [parent, index], [parent, index + 1]);
  // The selection Lexical read covers exactly that image, with no text.
  expect(
    editor.read(() => {
      const selection = $getSelection();
      return {
        keys: selection?.getNodes().map((node) => node.getKey()),
        text: selection?.getTextContent(),
      };
    })
  ).toEqual({ keys: [key], text: '' });
}

/** The touch toolbar's visible page, not its hidden measuring row. */
const options = () =>
  screen
    .queryAllByRole('button')
    .filter(
      (button) =>
        !button.closest('[aria-hidden="true"], [inert]') &&
        !['Previous options', 'More options'].includes(
          button.getAttribute('aria-label') ?? ''
        )
    )
    .map((button) => button.textContent?.trim());

/** Whether a toolbar element renders at all, and how many options it shows:
 *  an empty floating pill is a compared fact. */
function toolbar() {
  const popup = document.querySelector('.z-action-menu');
  return {
    rendered: popup !== null,
    options: options().length,
    suppressed: device.suppressed.at(-1) ?? false,
  };
}

test('Source control: $getMarkIdsAtCaret at each caret placement', () => {
  const read = (ids: string[]) => {
    const { editor } = mount({ ids, threads: [], canEdit: true });
    return editor.read(() => {
      const paragraph = $getRoot().getFirstChildOrThrow();
      if (!$isElementNode(paragraph)) throw new Error('Missing paragraph');
      const [before, mark, after] = paragraph.getChildren();
      if (!$isTextNode(before) || !$isElementNode(mark) || !$isTextNode(after))
        throw new Error('Unexpected seed shape');
      const marked = mark.getFirstChildOrThrow();
      return {
        insideMark: $getMarkIdsAtCaret(marked, 2),
        textEndBeforeMark: $getMarkIdsAtCaret(before, 7),
        offsetZeroAfterMark: $getMarkIdsAtCaret(after, 0),
        markElement: $getMarkIdsAtCaret(mark, 1),
        outside: $getMarkIdsAtCaret(before, 2),
        paragraphElement: $getMarkIdsAtCaret(paragraph, 3),
      };
    });
  };
  expect(read(['mark-a'])).toEqual({
    insideMark: ['mark-a'],
    textEndBeforeMark: ['mark-a'],
    offsetZeroAfterMark: ['mark-a'],
    markElement: ['mark-a'],
    outside: null,
    paragraphElement: null,
  });
  // An id-less mark: [] (not null), so `!= null` admits it.
  expect(read([])).toEqual({
    insideMark: [],
    textEndBeforeMark: [],
    offsetZeroAfterMark: [],
    markElement: [],
    outside: null,
    paragraphElement: null,
  });
});

test('Source control: a caret in a mark with a highlighted thread shows only Show comment', async () => {
  const { body } = mount({ ids: ['mark-a'], threads: ['t1'], canEdit: true });
  await caret(body, 'marked', 2);
  await popupSettled();
  expect(options()).toEqual(['Show comment']);
  expect(toolbar()).toEqual({ rendered: true, options: 1, suppressed: true });
});

test('Source control: on iOS with Edit, the caret toolbar adds Paste', async () => {
  device.ios = true;
  const { body } = mount({ ids: ['mark-a'], threads: ['t1'], canEdit: true });
  await caret(body, 'marked', 2);
  await popupSettled();
  expect(options()).toEqual(['Show comment', 'Paste']);
  expect(device.suppressed.at(-1)).toBe(true);
});

test('Source control: on iOS read-only, suppression is on and there is no Paste', async () => {
  device.ios = true;
  const { body } = mount({ ids: ['mark-a'], threads: ['t1'], canEdit: false });
  await caret(body, 'marked', 2);
  await popupSettled();
  expect(options()).toEqual(['Show comment']);
  expect(device.suppressed.at(-1)).toBe(true);
});

test('Source control: an id-less mark is admitted with no Show comment', async () => {
  const rows = [];
  for (const [row, ios, canEdit] of [
    ['android, edit', false, true],
    ['android, read-only', false, false],
    ['iOS, edit', true, true],
    ['iOS, read-only', true, false],
  ] as const) {
    await unmount();
    device.ios = ios;
    const { body } = mount({ ids: [], threads: [], canEdit });
    await caret(body, 'marked', 2);
    await popupSettled();
    rows.push({ row, labels: options(), ...toolbar() });
  }
  // Recorded literally: admission (suppression on) apart from the buttons.
  expect(rows).toEqual([
    {
      row: 'android, edit',
      labels: [],
      rendered: true,
      options: 0,
      suppressed: true,
    },
    {
      row: 'android, read-only',
      labels: [],
      rendered: true,
      options: 0,
      suppressed: true,
    },
    {
      row: 'iOS, edit',
      labels: ['Paste'],
      rendered: true,
      options: 1,
      suppressed: true,
    },
    {
      row: 'iOS, read-only',
      labels: [],
      rendered: true,
      options: 0,
      suppressed: true,
    },
  ]);
});

test('Source control: a caret outside any comment shows nothing', async () => {
  const { body } = mount({ ids: ['mark-a'], threads: ['t1'], canEdit: true });
  await caret(body, 'Before ', 2);
  await popupSettled();
  expect(toolbar()).toEqual({ rendered: false, options: 0, suppressed: false });
});

test('Source control: a zero-text range over only an inline image, inside and outside the mark', async () => {
  const rows = [];
  for (const placement of ['inside', 'outside'] as const) {
    await unmount();
    const { editor, body } = mount({
      ids: ['mark-a'],
      threads: ['t1'],
      canEdit: true,
    });
    await imageOnly(editor, body, placement);
    await popupSettled();
    rows.push({ placement, labels: options(), ...toolbar() });
  }
  expect(rows).toEqual([
    {
      placement: 'inside',
      labels: ['Show comment'],
      rendered: true,
      options: 1,
      suppressed: true,
    },
    {
      placement: 'outside',
      labels: [],
      rendered: false,
      options: 0,
      suppressed: false,
    },
  ]);
});
