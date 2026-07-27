import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import { batch, createRoot, createSignal } from 'solid-js';
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

type HarnessOptions = {
  rows?: SoupRow[];
  isLoading?: boolean;
  isFetching?: boolean;
  isPlaceholderData?: boolean;
};

const createHarness = (initial: HarnessOptions = {}) => {
  const disengagePreview = vi.fn();
  let dispose!: () => void;
  let setRows!: (rows: SoupRow[]) => void;
  let setLoading!: (loading: boolean) => void;
  let setFetching!: (fetching: boolean) => void;
  let setPlaceholderData!: (placeholder: boolean) => void;

  createRoot((rootDispose) => {
    dispose = rootDispose;
    const [rows, updateRows] = createSignal(initial.rows ?? [row()]);
    const [isLoading, updateLoading] = createSignal(initial.isLoading ?? false);
    const [isFetching, updateFetching] = createSignal(
      initial.isFetching ?? false
    );
    const [isPlaceholderData, updatePlaceholderData] = createSignal(
      initial.isPlaceholderData ?? false
    );
    setRows = updateRows;
    setLoading = updateLoading;
    setFetching = updateFetching;
    setPlaceholderData = updatePlaceholderData;
    useSoupPreviewAvailability({
      rows,
      isLoading,
      isFetching,
      isPlaceholderData,
      splitHandle: {
        isControllerSplit: () => true,
        disengagePreview,
      } as unknown as SplitHandle,
    });
  });

  return {
    disengagePreview,
    dispose,
    setRows,
    setLoading,
    setFetching,
    setPlaceholderData,
  };
};

describe('Soup preview availability', () => {
  it('requires an entity row rather than a group or load-more row', () => {
    expect(
      hasPreviewableSoupRows([row({ grouped: true }), row({ loadMore: true })])
    ).toBe(false);
    expect(hasPreviewableSoupRows([row({ grouped: true }), row()])).toBe(true);
  });

  it('disengages preview when the last entity row disappears', async () => {
    const harness = createHarness();

    await flushEffects();
    expect(harness.disengagePreview).not.toHaveBeenCalled();

    harness.setRows([]);
    await flushEffects();
    expect(harness.disengagePreview).toHaveBeenCalledOnce();
    harness.dispose();
  });

  it('keeps preview open while an empty result is still loading', async () => {
    const harness = createHarness({ rows: [], isLoading: true });

    await flushEffects();
    expect(harness.disengagePreview).not.toHaveBeenCalled();

    harness.setLoading(false);
    await flushEffects();
    expect(harness.disengagePreview).toHaveBeenCalledOnce();
    harness.dispose();
  });

  it('keeps preview open across a tab switch whose fetch repopulates the rows', async () => {
    const harness = createHarness();

    await flushEffects();

    // Tab switch: the kept-previous rows all fail the next tab's client
    // predicates (e.g. Signal rows never match Noise) while its uncached
    // query is in flight — `isLoading` stays false the whole time.
    batch(() => {
      harness.setRows([]);
      harness.setFetching(true);
    });
    await flushEffects();
    expect(harness.disengagePreview).not.toHaveBeenCalled();

    batch(() => {
      harness.setRows([row()]);
      harness.setFetching(false);
    });
    await flushEffects();
    expect(harness.disengagePreview).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('keeps preview open while rows are placeholder data from the previous tab', async () => {
    const harness = createHarness();

    await flushEffects();

    batch(() => {
      harness.setRows([]);
      harness.setPlaceholderData(true);
    });
    await flushEffects();
    expect(harness.disengagePreview).not.toHaveBeenCalled();

    batch(() => {
      harness.setRows([row()]);
      harness.setPlaceholderData(false);
    });
    await flushEffects();
    expect(harness.disengagePreview).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('disengages preview once a fetch settles on an empty result', async () => {
    const harness = createHarness();

    await flushEffects();

    batch(() => {
      harness.setRows([]);
      harness.setFetching(true);
    });
    await flushEffects();
    expect(harness.disengagePreview).not.toHaveBeenCalled();

    harness.setFetching(false);
    await flushEffects();
    expect(harness.disengagePreview).toHaveBeenCalledOnce();
    harness.dispose();
  });
});
