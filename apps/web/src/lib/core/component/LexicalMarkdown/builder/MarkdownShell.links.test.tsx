import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { Dialog } from '@ui';
import { $getRoot } from 'lexical';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRY_INSERT_LINK_COMMAND } from '../plugins/links/linksPlugin';
import { buildConfig } from './MarkdownConfigBuilder';
import { MarkdownShell } from './MarkdownShell';

// Keep the real editor and modal focus scope; this test needs no app services
// or floating-menu geometry from the browser layout engine.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));
vi.mock('@core/signal/unfurl', () => ({
  useUnfurl: () => [() => null],
}));
vi.mock('../directive/floatWithElement', () => ({
  floatWithElement: () => {},
}));
vi.mock('../directive/floatWithSelection', () => ({
  floatWithSelection: () => {},
}));

class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    queueMicrotask(() => this.callback([], this));
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  window.scrollTo = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('MarkdownShell link menus', () => {
  it('keeps link editing inside a modal so the URL receives focus and can be saved', async () => {
    const config = buildConfig('markdown').withLinks();
    render(() => (
      <Dialog open onOpenChange={vi.fn()}>
        <Dialog.Title>Agent instructions</Dialog.Title>
        <Dialog.Description>Edit the agent instructions.</Dialog.Description>
        <MarkdownShell
          config={config}
          initialValue="Research evidence."
          portalScope="local"
        />
      </Dialog>
    ));
    await waitFor(() =>
      expect(config.controls.getMarkdown()).toContain('Research evidence.')
    );
    config.lexical.update(() => $getRoot().selectEnd(), { discrete: true });
    config.lexical.dispatchCommand(TRY_INSERT_LINK_COMMAND, undefined);

    const url = await screen.findByPlaceholderText('https://example.com');
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(url)).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(url));
    fireEvent.input(url, { target: { value: 'https://example.com/research' } });
    fireEvent.input(screen.getByPlaceholderText('Link text'), {
      target: { value: 'Sources' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() =>
      expect(config.controls.getMarkdown()).toContain(
        'https://example.com/research'
      )
    );
    expect(
      screen.getByRole('link', { name: 'Sources' }).getAttribute('href')
    ).toBe('https://example.com/research');
    expect(screen.queryByPlaceholderText('https://example.com')).toBeNull();
    expect(screen.getByRole('dialog')).toBe(dialog);
  });

  it('keeps the existing global fallback when no portal scope is requested', async () => {
    const config = buildConfig('markdown').withLinks();
    const { container } = render(() => (
      <div class="portal-scope">
        <MarkdownShell config={config} initialValue="Research evidence." />
      </div>
    ));
    await waitFor(() =>
      expect(config.controls.getMarkdown()).toContain('Research evidence.')
    );
    config.lexical.update(() => $getRoot().selectEnd(), { discrete: true });
    config.lexical.dispatchCommand(TRY_INSERT_LINK_COMMAND, undefined);

    const url = await screen.findByPlaceholderText('https://example.com');
    expect(container.contains(url)).toBe(false);
    expect(document.body.contains(url)).toBe(true);
  });
});
