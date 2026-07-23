import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { SoupRow } from '../create-soup-state';
import {
  hasPreviewableSoupRows,
  useSoupPreviewAvailability,
} from './use-soup-preview-availability';

const row = (
  options: { grouped?: boolean; loadMore?: boolean } = {}
): SoupRow =>
  ({
    getIsGrouped: () => options.grouped ?? false,
    getIsLoadMore: () => options.loadMore ?? false,
  }) as SoupRow;

const flushEffects = () => Promise.resolve();

describe('Soup preview availability', () => {
  it('requires an entity row rather than a group or load-more row', () => {
    expect(
      hasPreviewableSoupRows([row({ grouped: true }), row({ loadMore: true })])
    ).toBe(false);
    expect(hasPreviewableSoupRows([row({ grouped: true }), row()])).toBe(true);
  });

  it('disengages preview when the last entity row disappears', async () => {
    const disengagePreview = vi.fn();
    let setRows!: (rows: SoupRow[]) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [rows, updateRows] = createSignal([row()]);
      setRows = updateRows;
      useSoupPreviewAvailability({
        rows,
        isLoading: () => false,
        splitHandle: {
          isControllerSplit: () => true,
          disengagePreview,
        } as unknown as SplitHandle,
      });
    });

    await flushEffects();
    expect(disengagePreview).not.toHaveBeenCalled();

    setRows([]);
    await flushEffects();
    expect(disengagePreview).toHaveBeenCalledOnce();
    dispose();
  });

  it('keeps preview open while an empty result is still loading', async () => {
    const disengagePreview = vi.fn();
    let setLoading!: (loading: boolean) => void;
    let dispose!: () => void;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      const [isLoading, updateLoading] = createSignal(true);
      setLoading = updateLoading;
      useSoupPreviewAvailability({
        rows: () => [],
        isLoading,
        splitHandle: {
          isControllerSplit: () => true,
          disengagePreview,
        } as unknown as SplitHandle,
      });
    });

    await flushEffects();
    expect(disengagePreview).not.toHaveBeenCalled();

    setLoading(false);
    await flushEffects();
    expect(disengagePreview).toHaveBeenCalledOnce();
    dispose();
  });
});
