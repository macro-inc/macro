/** @vitest-environment jsdom */

import { Telemetry } from '@macro-inc/observability';
import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createNativeActionMenuHost } from '../../../../lib/core/component/LexicalMarkdown/editing/overlay-hosts/native-actions';
import { ACTIONS } from '../../../../lib/core/component/LexicalMarkdown/plugins/actions/actions';
import { dispatchApplicationCommandSettled } from '../../../../lib/core/component/LexicalMarkdown/plugins/group-b/command';
import * as url from '../../../../lib/core/util/url';
import { MarkdownDocumentProvider } from '../../context/markdown-document-context';
import { createMarkdownDocumentState } from '../../context/markdown-document-state';
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

function setup() {
  const [canEdit, setCanEdit] = createSignal(true);
  const optionalErrors = vi.spyOn(Telemetry, 'error');
  const formatting = createNativeBodyFormattingOverlay({
    canEdit,
    alive: () => true,
  });
  const runtime = mount([formatting.observer]);
  // jsdom does not make contenteditable elements focusable like a browser.
  runtime.root.tabIndex = 0;
  // Source MarkdownPopup positions inside the document's local portal scope.
  const portalScope = document.createElement('div');
  portalScope.className = 'portal-scope';
  document.body.append(portalScope);
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
          state: documentState,
          element: () => runtime.root,
        }}
      >
        <formatting.Overlay />
      </MarkdownDocumentProvider>
    ),
    { container: portalScope }
  );
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
  const dispose = async () => {
    formatting.dispose();
    rendered.unmount();
    await runtime.close();
    runtime.root.remove();
    portalScope.remove();
  };
  return {
    runtime,
    formatting,
    rendered,
    optionalErrors,
    click,
    dispose,
    setCanEdit,
  };
}

test('an existing native link opens the shared URL editor', async () => {
  const fixture = setup();
  try {
    fixture.click();
    expect(fixture.optionalErrors).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText('https://example.com')).not.toBeNull();
    expect(
      screen.getByPlaceholderText<HTMLInputElement>('https://example.com').value
    ).toBe('https://example.com');
  } finally {
    await fixture.dispose();
  }
});

test('a read-only view opens the link destination without an edit menu', async () => {
  const open = vi.spyOn(url, 'openExternalUrl').mockImplementation(() => {});
  const fixture = setup();
  try {
    fixture.runtime.view.setEditable(false);
    expect(fixture.formatting.host()?.editable()).toBe(false);
    fixture.click();
    expect(open).toHaveBeenCalledExactlyOnceWith('https://example.com');
    expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
    expect(fixture.optionalErrors).not.toHaveBeenCalled();
  } finally {
    await fixture.dispose();
  }
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
    await fixture.dispose();
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
    await fixture.dispose();
  }
});

test('the shared URL editor commits an existing-link URL through Enter', async () => {
  const fixture = setup();
  try {
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
  } finally {
    await fixture.dispose();
  }
});

test('revoking interaction closes an already-open link editor', async () => {
  const fixture = setup();
  try {
    fixture.click();
    expect(screen.queryByPlaceholderText('https://example.com')).not.toBeNull();
    fixture.setCanEdit(false);
    expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
    expect(fixture.optionalErrors).not.toHaveBeenCalled();
  } finally {
    await fixture.dispose();
  }
});

test('a locked document cannot open the existing-link editor', async () => {
  const fixture = setup();
  try {
    fixture.setCanEdit(false);
    fixture.click();
    expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
    expect(fixture.optionalErrors).not.toHaveBeenCalled();
  } finally {
    await fixture.dispose();
  }
});

test('ordered Escape closes the existing-link editor and refocuses the view', async () => {
  const fixture = setup();
  try {
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
  } finally {
    await fixture.dispose();
  }
});

test('disposing the overlay removes the URL editor and its ordered key handlers', async () => {
  const fixture = setup();
  try {
    fixture.click();
    expect(screen.queryByPlaceholderText('https://example.com')).not.toBeNull();
    fixture.formatting.dispose();
    expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
    expect(fixture.runtime.port.nativeEscape?.hasListeners()).toBe(false);
    expect(fixture.runtime.port.nativeEnter?.hasListeners()).toBe(false);
    fixture.click();
    expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
    expect(fixture.optionalErrors).not.toHaveBeenCalled();
  } finally {
    await fixture.dispose();
  }
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
  try {
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
      expect(
        fixture.runtime.root.querySelector('a')?.getAttribute('href')
      ).toBe('https://example.org')
    );
    expect(fixture.runtime.root.textContent).toBe('site body');
    expect(fixture.optionalErrors).not.toHaveBeenCalled();
  } finally {
    actions.dispose();
    await fixture.dispose();
  }
});
