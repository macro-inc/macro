/** @vitest-environment jsdom */

import { Telemetry } from '@macro-inc/observability';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import {
  afterEach,
  beforeEach,
  expect,
  onTestFinished,
  test,
  vi,
} from 'vitest';
import { createNativeActionMenuHost } from '../../../../lib/core/component/LexicalMarkdown/editing/overlay-hosts/native-actions';
import { ACTIONS } from '../../../../lib/core/component/LexicalMarkdown/plugins/actions/actions';
import { dispatchApplicationCommandSettled } from '../../../../lib/core/component/LexicalMarkdown/plugins/group-b/command';
import * as url from '../../../../lib/core/util/url';
import { MarkdownDocumentProvider } from '../../context/markdown-document-context';
import { createMarkdownDocumentState } from '../../context/markdown-document-state';
import { desktopBodyFormatPopup } from '../../views/body-format-popup';
import { createNativeBodyFormattingOverlay } from './native-overlay';
import { mount, select, state } from './native-test-fixture';

const originalRectangle = Object.getOwnPropertyDescriptor(
  Range.prototype,
  'getBoundingClientRect'
);
beforeEach(() => {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(0, 0, 100, 20),
  });
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
  if (originalRectangle)
    Object.defineProperty(
      Range.prototype,
      'getBoundingClientRect',
      originalRectangle
    );
  else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// Each acquisition registers its release at once: Vitest runs onTestFinished hooks in
// reverse, independently, and records every failure next to the test's own.
function setup() {
  const [canEdit, setCanEdit] = createSignal(true);
  const optionalErrors = vi.spyOn(Telemetry, 'error');
  const formatting = createNativeBodyFormattingOverlay({
    composition: () => desktopBodyFormatPopup,
    canEdit,
    alive: () => true,
  });
  onTestFinished(() => formatting.dispose());
  const runtime = mount([formatting.observer]);
  onTestFinished(() => runtime.root.remove());
  onTestFinished(() => runtime.close());
  // jsdom does not make contenteditable elements focusable like a browser.
  runtime.root.tabIndex = 0;
  // Source MarkdownPopup positions inside the document's local portal scope.
  const portalScope = document.createElement('div');
  portalScope.className = 'portal-scope';
  document.body.append(portalScope);
  onTestFinished(() => portalScope.remove());
  portalScope.append(runtime.root);
  const documentState = createMarkdownDocumentState();
  const rendered = render(
    () => (
      <MarkdownDocumentProvider
        context={{
          documentId: () => 'native-link-activation',
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
          state: documentState,
          element: () => runtime.root,
        }}
      >
        <formatting.Overlay />
      </MarkdownDocumentProvider>
    ),
    { container: portalScope }
  );
  onTestFinished(() => rendered.unmount());
  runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              {
                type: 'link',
                version: 1,
                url: 'https://example.com',
                children: [{ type: 'text', version: 1, text: 'linked' }],
              },
            ],
          },
        ],
      },
    })
  );
  const text = [...runtime.view.mirror.values()].find(
    (node) => node.kind === 'text' && node.text === 'linked'
  );
  if (!text) throw new Error('Missing actual native link text');
  runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, offset: 1, type: 'text' },
    focus: { key: text.key, offset: 1, type: 'text' },
  });
  expect(optionalErrors).not.toHaveBeenCalled();
  expect(runtime.port.nativeEscape?.hasListeners()).toBe(true);
  const link = runtime.root.querySelector('a');
  if (!link) throw new Error('Missing actual native anchor');
  expect(link.getAttribute('href')).toBe('https://example.com');
  const click = () =>
    link.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
  return {
    runtime,
    formatting,
    rendered,
    optionalErrors,
    click,
    setCanEdit,
  };
}

test('an existing native link opens the shared URL editor', async () => {
  const fixture = setup();
  fixture.click();
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
  expect(screen.queryByPlaceholderText('https://example.com')).not.toBeNull();
  expect(
    screen.getByPlaceholderText<HTMLInputElement>('https://example.com').value
  ).toBe('https://example.com');
});

test('a read-only view opens the link destination without an edit menu', async () => {
  const open = vi.spyOn(url, 'openExternalUrl').mockImplementation(() => {});
  const fixture = setup();
  fixture.runtime.view.setEditable(false);
  expect(fixture.formatting.host()?.editable()).toBe(false);
  fixture.click();
  expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com');
  expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
});

test('expanded global Prepare opens the URL editor and Escape retains the Source empty link', async () => {
  const fixture = setup();
  try {
    fixture.runtime.port.setState(state('label'));
    select(fixture.runtime, 'label');
    const host = fixture.formatting.host();
    if (!host)
      throw new Error('Actual published formatting host is unavailable');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    host.requestLink();
    await vi.advanceTimersByTimeAsync(0);
    expect(
      screen.getByPlaceholderText<HTMLInputElement>('https://example.com').value
    ).toBe('');
    expect(
      [...fixture.runtime.view.mirror.values()]
        .find((node) => node.type === 'link')
        ?.props().url
    ).toBe('');
    expect(fixture.runtime.root.querySelector('a')?.getAttribute('href')).toBe(
      'https://'
    );
    const prepared = fixture.runtime.view.selection().selection;
    expect(fixture.runtime.port.nativeEscape?.dispatch()).toBe(true);
    expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
    expect(
      [...fixture.runtime.view.mirror.values()]
        .find((node) => node.type === 'link')
        ?.props().url
    ).toBe('');
    expect(fixture.runtime.root.querySelector('a')?.getAttribute('href')).toBe(
      'https://'
    );
    expect(fixture.runtime.view.selection().selection).toEqual(prepared);
    expect(document.activeElement).toBe(fixture.runtime.root);
    expect(fixture.optionalErrors).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test('revocation after real Prepare prevents the deferred URL editor from opening', async () => {
  const fixture = setup();
  try {
    fixture.runtime.port.setState(state('label'));
    select(fixture.runtime, 'label');
    const host = fixture.formatting.host();
    if (!host)
      throw new Error('Actual published formatting host is unavailable');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    host.requestLink();
    expect(
      [...fixture.runtime.view.mirror.values()]
        .find((node) => node.type === 'link')
        ?.props().url
    ).toBe('');
    expect(fixture.runtime.root.querySelector('a')?.getAttribute('href')).toBe(
      'https://'
    );
    fixture.setCanEdit(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
    expect(
      [...fixture.runtime.view.mirror.values()]
        .find((node) => node.type === 'link')
        ?.props().url
    ).toBe('');
    expect(fixture.runtime.root.querySelector('a')?.getAttribute('href')).toBe(
      'https://'
    );
    expect(fixture.optionalErrors).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test('the shared URL editor commits an existing-link URL through Enter', async () => {
  const fixture = setup();
  fixture.click();
  const selection = fixture.runtime.view.selection().selection;
  fireEvent.input(screen.getByPlaceholderText('https://example.com'), {
    target: { value: 'https://updated.example/path' },
  });
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
  );
  expect(fixture.runtime.root.querySelector('a')?.getAttribute('href')).toBe(
    'https://updated.example/path'
  );
  expect(fixture.runtime.view.selection().selection).toEqual(selection);
  expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
  expect(document.activeElement).toBe(fixture.runtime.root);
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
});

test('revoking interaction closes an already-open link editor', async () => {
  const fixture = setup();
  fixture.click();
  expect(screen.queryByPlaceholderText('https://example.com')).not.toBeNull();
  fixture.setCanEdit(false);
  expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
});

test('a locked document cannot open the existing-link editor', async () => {
  const fixture = setup();
  fixture.setCanEdit(false);
  fixture.click();
  expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
});

test('ordered Escape closes the existing-link editor and refocuses the view', async () => {
  const fixture = setup();
  fixture.click();
  const input = screen.getByPlaceholderText('https://example.com');
  input.focus();
  expect(document.activeElement).toBe(input);
  expect(fixture.runtime.port.nativeEscape?.dispatch()).toBe(true);
  expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
  expect(document.activeElement).toBe(fixture.runtime.root);
  expect(fixture.runtime.root.querySelector('a')?.getAttribute('href')).toBe(
    'https://example.com'
  );
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
});

test('disposing the overlay removes the URL editor and its ordered key handlers', async () => {
  const fixture = setup();
  fixture.click();
  expect(screen.queryByPlaceholderText('https://example.com')).not.toBeNull();
  fixture.formatting.dispose();
  expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
  expect(fixture.runtime.port.nativeEscape?.hasListeners()).toBe(false);
  expect(fixture.runtime.port.nativeEnter?.hasListeners()).toBe(false);
  fixture.click();
  expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
});

test('the slash Link row opens the Source create-link editor after actual search removal', async () => {
  const fixture = setup();
  const actions = createNativeActionMenuHost(
    fixture.runtime.view,
    {
      requestTable() {},
      requestLink: () => fixture.formatting.requestLink(),
    },
    () => true
  );
  onTestFinished(() => actions.dispose());
  fixture.runtime.port.setState(state(' body'));
  const text = [...fixture.runtime.view.mirror.values()].find(
    (node) => node.kind === 'text' && node.text === ' body'
  );
  if (!text) throw new Error('Missing actual native text');
  fixture.runtime.port.selectionFromView({
    kind: 'range',
    anchor: { key: text.key, offset: 0, type: 'text' },
    focus: { key: text.key, offset: 0, type: 'text' },
  });
  const trigger = await dispatchApplicationCommandSettled(
    fixture.runtime.view,
    'group-a.search-trigger',
    { kind: 'actions' }
  );
  expect(trigger).toMatchObject({ status: 'success', handled: true });
  const link = ACTIONS.find((item) => item.id === 'link');
  if (!link) throw new Error('Missing actual Link catalog item');
  expect(actions.supports(link)).toBe(true);
  actions.select(link, 'keyboard');
  const label =
    await screen.findByPlaceholderText<HTMLInputElement>('Link text');
  expect(fixture.runtime.root.querySelector('a')).toBeNull();
  expect(fixture.runtime.root.textContent).toBe(' body');
  fireEvent.input(screen.getByPlaceholderText('https://example.com'), {
    target: { value: 'example.org' },
  });
  fireEvent.input(label, { target: { value: 'site' } });
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
  );
  await vi.waitFor(() =>
    expect(fixture.runtime.root.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.org'
    )
  );
  expect(fixture.runtime.root.textContent).toBe('site body');
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
});

test('the existing-link menu Remove link unlinks like Source', async () => {
  const fixture = setup();
  fixture.click();
  const menu = screen
    .getByPlaceholderText('https://example.com')
    .closest('.menu-surface');
  if (!menu) throw new Error('Missing actual link menu surface');
  const buttons = [...menu.querySelectorAll('button')];
  // FloatingLinkMenu :438-466: Open in new tab, Edit link, Copy link, Remove link.
  const remove = buttons[3];
  if (!remove) throw new Error('Missing Remove link button');
  fireEvent.click(remove);
  await vi.waitFor(() =>
    expect(fixture.runtime.root.querySelector('a')).toBeNull()
  );
  const paragraph = [...fixture.runtime.view.mirror.values()].find(
    (node) => node.type === 'paragraph'
  );
  expect(
    paragraph?.children.map((key) => {
      const node = fixture.runtime.view.mirror.node(key);
      return [node?.type, node?.text];
    })
  ).toEqual([['unlinked-text', 'linked']]);
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
});

// A real click's selectionchange can arrive after the click event that opens the menu.
test('Remove link uses the caret admitted after the opening click', async () => {
  const fixture = setup();
  fixture.runtime.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [
          {
            type: 'paragraph',
            version: 1,
            children: [
              { type: 'text', version: 1, text: 'Hello ' },
              {
                type: 'link',
                version: 1,
                url: 'https://example.com',
                children: [{ type: 'text', version: 1, text: 'linked' }],
              },
            ],
          },
        ],
      },
    })
  );
  const nodes = [...fixture.runtime.view.mirror.values()];
  const hello = nodes.find((node) => node.text === 'Hello ');
  const linked = nodes.find((node) => node.text === 'linked');
  if (!hello || !linked) throw new Error('Missing actual native text');
  const helloDOM = fixture.runtime.view.getElementByKey(hello.key)?.firstChild;
  const linkedDOM = fixture.runtime.view.getElementByKey(
    linked.key
  )?.firstChild;
  const anchor = fixture.runtime.root.querySelector('a');
  const dom = document.getSelection();
  if (!helloDOM || !linkedDOM || !anchor || !dom)
    throw new Error('Missing actual native DOM');
  fixture.runtime.root.focus();
  // jsdom does not emit the selectionchange for setState's own DOM selection write.
  document.dispatchEvent(new Event('selectionchange'));
  dom.setBaseAndExtent(helloDOM, 2, helloDOM, 2);
  document.dispatchEvent(new Event('selectionchange'));
  expect(fixture.runtime.view.selection().selection).toMatchObject({
    kind: 'range',
    anchor: { key: hello.key, offset: 2, type: 'text' },
    focus: { key: hello.key, offset: 2, type: 'text' },
  });
  // The press moved the browser caret into the link; its selectionchange is still queued.
  dom.setBaseAndExtent(linkedDOM, 2, linkedDOM, 2);
  anchor.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true })
  );
  expect(fixture.runtime.view.selection().selection).toMatchObject({
    kind: 'range',
    anchor: { key: hello.key, offset: 2, type: 'text' },
    focus: { key: hello.key, offset: 2, type: 'text' },
  });
  document.dispatchEvent(new Event('selectionchange'));
  expect(fixture.runtime.view.selection().selection).toMatchObject({
    kind: 'range',
    anchor: { key: linked.key, offset: 2, type: 'text' },
    focus: { key: linked.key, offset: 2, type: 'text' },
  });
  const menu = screen
    .getByPlaceholderText('https://example.com')
    .closest('.menu-surface');
  const remove = menu ? [...menu.querySelectorAll('button')][3] : undefined;
  if (!remove) throw new Error('Missing Remove link button');
  fireEvent.click(remove);
  await vi.waitFor(() =>
    expect(fixture.runtime.root.querySelector('a')).toBeNull()
  );
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
});

test('the body popup Link button opens the Source link prompt and links the selection', async () => {
  const fixture = setup();
  fixture.runtime.port.setState(state('label'));
  fixture.runtime.root.focus();
  select(fixture.runtime, 'label');
  await screen.findByRole('button', { name: 'Bold' });
  // Source FormatTools order: Bold, Italic, Link, More, block type.
  const buttons = screen
    .getByRole('toolbar')
    .querySelectorAll<HTMLButtonElement>('button');
  expect(
    [...buttons].map(
      (button) =>
        button.getAttribute('aria-label') ??
        (button.getAttribute('aria-haspopup') ? 'menu:' : '') +
          (button.textContent ?? '')
    )
  ).toEqual(['Bold', 'Italic', 'Insert Link', 'More formatting', 'menu:Body']);
  fireEvent.click(screen.getByRole('button', { name: 'Insert Link' }));
  // Source MarkdownPopup: the prompt replaces the toolbar; nothing is linked yet.
  const input = screen.getByPlaceholderText<HTMLInputElement>(
    'Paste or insert link'
  );
  expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
  expect(
    [...fixture.runtime.view.mirror.values()].some(
      (node) => node.type === 'link'
    )
  ).toBe(false);
  fireEvent.input(input, { target: { value: 'example.org' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  await vi.waitFor(() =>
    expect(fixture.runtime.root.querySelector('a')?.textContent).toBe('label')
  );
  const link = [...fixture.runtime.view.mirror.values()].find(
    (node) => node.type === 'link'
  );
  expect(link?.props().url).toBe('https://example.org');
  expect(screen.queryByPlaceholderText('Paste or insert link')).toBeNull();
  expect(fixture.optionalErrors).not.toHaveBeenCalled();
});
