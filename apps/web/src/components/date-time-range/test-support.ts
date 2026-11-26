import { vi } from 'vitest';

class TimeInputResizeObserver implements ResizeObserver {
  private connected = true;
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    queueMicrotask(() => {
      if (this.connected) this.callback([], this);
    });
  }
  unobserve() {}
  disconnect() {
    this.connected = false;
  }
}

/** jsdom has no layout observer; keep connection callbacks asynchronous like the browser. */
export function installTimeInputResizeObserver() {
  vi.stubGlobal('ResizeObserver', TimeInputResizeObserver);
}
