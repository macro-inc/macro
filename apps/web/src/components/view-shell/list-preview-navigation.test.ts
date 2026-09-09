import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import type { EntityData } from '@entity';
import { describe, expect, it, vi } from 'vitest';
import {
  openListPreview,
  registerListPreview,
  shouldInitializeList,
} from './list-preview-navigation';

const handle = (controller = false) =>
  ({ isControllerSplit: () => controller }) as SplitHandle;
const draft = { type: 'email', id: 'draft', name: 'Proposal' } as EntityData;

describe('inner list navigation', () => {
  it('opens ordinary items in their own workspace and unregisters on disposal', () => {
    const first = handle();
    const second = handle();
    const open = vi.fn();
    const dispose = registerListPreview(first, open);
    expect(openListPreview(draft, { splitHandle: second })).toBe(false);
    expect(openListPreview(draft, { splitHandle: first })).toBe(true);
    expect(open).toHaveBeenCalledWith(draft);
    dispose();
    expect(openListPreview(draft, { splitHandle: first })).toBe(false);
  });
  it('preserves explicit split actions, preview pairs, and folder navigation', () => {
    const splitHandle = handle();
    const controller = handle(true);
    const open = vi.fn();
    registerListPreview(splitHandle, open);
    registerListPreview(controller, open);
    expect(openListPreview(draft, { splitHandle, openInNewSplit: true })).toBe(
      false
    );
    expect(openListPreview(draft, { splitHandle, replacePreview: true })).toBe(
      false
    );
    expect(openListPreview(draft, { splitHandle: controller })).toBe(false);
    expect(
      openListPreview({ type: 'project', id: 'folder' } as EntityData, {
        splitHandle,
      })
    ).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
  it('does not reset the current filters when returning from a preview', () => {
    const splitHandle = handle();
    const dispose = registerListPreview(splitHandle, vi.fn());
    expect(shouldInitializeList(splitHandle)).toBe(true);
    openListPreview(draft, { splitHandle });
    expect(shouldInitializeList(splitHandle)).toBe(false);
    dispose();
    registerListPreview(splitHandle, vi.fn());
    expect(shouldInitializeList(splitHandle)).toBe(true);
  });
});
