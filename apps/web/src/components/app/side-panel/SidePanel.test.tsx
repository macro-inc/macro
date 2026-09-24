import { FloatRegion } from '@components/app/mobile/float-regions/FloatRegion';
import { FloatRegions } from '@components/app/mobile/float-regions/float-region-state';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => true }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => true }));
// The block registry globs every block definition (and their heavy
// dependencies) at import time; the panel never reads it.
vi.mock('@core/constant/allBlocks', () => ({
  blocks: {},
  blockAcceptedMimetypeToFileExtension: {},
  blockAcceptedFileExtensionToMimeType: {},
}));
vi.mock('@service-storage/websocket', () => ({
  storageWS: { send() {}, addEventListener() {}, removeEventListener() {} },
  createWebSocketJob: () => Promise.reject(new Error('no websocket in tests')),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener() {}, send() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: () => {},
  createConnectionWebsocketEffect: () => {},
}));

import { SidePanel, useSidePanel } from './SidePanel';

function OpenButton() {
  const panel = useSidePanel();
  return (
    <button type="button" onClick={() => panel?.toggle()}>
      Toggle details
    </button>
  );
}

function Harness() {
  return (
    <>
      <SidePanel.Layout defaultOpen={false} headerToggle={false}>
        <OpenButton />
        <SidePanel.Section id="details" title="Details" defaultOpen>
          <div>Disconnected</div>
        </SidePanel.Section>
        <FloatRegion region="accessory">
          <button type="button">Review changes</button>
        </FloatRegion>
      </SidePanel.Layout>
      {/* Stands in for MobilePageActionRow, the app-level fallback. */}
      <FloatRegion region="accessory" priority={-1}>
        <button type="button">Ask AI</button>
      </FloatRegion>
    </>
  );
}

let mount: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  mount = document.createElement('div');
  document.body.append(mount);
  FloatRegions.setMount('accessory', mount);
});

afterEach(() => {
  cleanup();
  mount.remove();
  vi.unstubAllGlobals();
});

describe('narrow side panel overlay', () => {
  it('takes over the frame from the block’s floating bottom chrome', () => {
    render(() => <Harness />);
    expect(screen.getByRole('button', { name: 'Review changes' })).toBeTruthy();
    expect(screen.queryByText('Disconnected')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Toggle details' }));
    // The float host sits above the panel's stacking context, so the region
    // has to empty out rather than hand the slot to the app-level fallback.
    expect(screen.getByText('Disconnected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ask AI' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back to content' }));
    expect(screen.getByRole('button', { name: 'Review changes' })).toBeTruthy();
    expect(screen.queryByText('Disconnected')).toBeNull();
  });
});
