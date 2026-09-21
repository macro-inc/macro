import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createEventDetailsOverlay } from './event-details-overlay';

describe('createEventDetailsOverlay', () => {
  it('holds the details open while any nested overlay is retained', () => {
    createRoot((dispose) => {
      const overlay = createEventDetailsOverlay(() => {});
      expect(overlay.hasNestedOverlay()).toBe(false);

      const releaseFirst = overlay.context.retain();
      const releaseSecond = overlay.context.retain();
      expect(overlay.hasNestedOverlay()).toBe(true);

      releaseFirst();
      expect(overlay.hasNestedOverlay()).toBe(true);
      releaseSecond();
      expect(overlay.hasNestedOverlay()).toBe(false);
      dispose();
    });
  });

  // A row that unmounts with its menu open releases in cleanup, and the menu
  // may already have released on close; the second call must not go negative
  // and mask a later retain.
  it('ignores a repeated release', () => {
    createRoot((dispose) => {
      const overlay = createEventDetailsOverlay(() => {});
      const release = overlay.context.retain();
      release();
      release();
      overlay.context.retain();
      expect(overlay.hasNestedOverlay()).toBe(true);
      dispose();
    });
  });

  it('closes through the callback it was given', () => {
    const close = vi.fn();
    createRoot((dispose) => {
      createEventDetailsOverlay(close).context.close();
      dispose();
    });
    expect(close).toHaveBeenCalledOnce();
  });
});
