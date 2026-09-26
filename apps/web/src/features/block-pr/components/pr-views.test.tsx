import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, onCleanup } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type PrView, PrViews } from './pr-views';

// Shared UI imports connect the websocket and block registry at module load;
// this presentational view never reads either app service.
vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect() {},
  createConnectionWebsocketEffect() {},
  parseWebsocketPayload: () => undefined,
}));
vi.mock('@core/constant/allBlocks', () => ({
  blocks: {},
  blockAcceptedMimetypeToFileExtension: {},
  blockAcceptedFileExtensionToMimeType: {},
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { send() {}, addEventListener() {}, removeEventListener() {} },
  createWebSocketJob: () => Promise.reject(new Error('no websocket in tests')),
}));

describe('PR views', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('opens a requested diff and returns to the overview, mounting only the selected view', () => {
    const [view, setView] = createSignal<PrView>('diff');
    const diffMounted = vi.fn();
    const diffDisposed = vi.fn();
    function Diff() {
      diffMounted();
      onCleanup(diffDisposed);
      return <p>Changed files</p>;
    }
    render(() => (
      <PrViews
        view={view()}
        onViewChange={setView}
        overview={<p>PR description and timeline</p>}
        diff={<Diff />}
      />
    ));

    expect(
      screen.getByRole('region', { name: 'Pull request diff' })
    ).toBeTruthy();
    expect(screen.getByText('Changed files')).toBeTruthy();
    expect(screen.queryByText('PR description and timeline')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Overview' }));
    expect(view()).toBe('overview');
    expect(screen.getByText('PR description and timeline')).toBeTruthy();
    expect(screen.queryByText('Changed files')).toBeNull();
    expect(diffDisposed).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('radio', { name: 'Diff' }));
    expect(view()).toBe('diff');
    expect(screen.getByText('Changed files')).toBeTruthy();
    expect(diffMounted).toHaveBeenCalledTimes(2);
  });

  it('does not create a diff source while the overview is selected', () => {
    const diffMounted = vi.fn();
    function Diff() {
      diffMounted();
      return <p>Changed files</p>;
    }
    render(() => (
      <PrViews
        view="overview"
        onViewChange={() => {}}
        overview={<p>PR description and timeline</p>}
        diff={<Diff />}
      />
    ));
    expect(diffMounted).not.toHaveBeenCalled();
    expect(screen.getByText('PR description and timeline')).toBeTruthy();
  });
});
