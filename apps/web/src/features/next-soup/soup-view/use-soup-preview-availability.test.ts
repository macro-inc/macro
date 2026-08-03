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

/**
 * A SplitHandle stub whose controller role follows engage/disengage calls,
 * mirroring how the layout manager reports a Preview Pair.
 */
const splitHandleStub = (options: { controller: boolean; room?: boolean }) => {
  let controller = options.controller;
  const engagePreview = vi.fn(() => {
    controller = true;
  });
  const disengagePreview = vi.fn(() => {
    controller = false;
  });
  return {
    engagePreview,
    disengagePreview,
    exitPreviewAsUser: () => {
      controller = false;
    },
    handle: {
      isControllerSplit: () => controller,
      isViewerSplit: () => false,
      canEngagePreview: () => options.room ?? true,
      engagePreview,
      disengagePreview,
    } as unknown as SplitHandle,
  };
};

type HarnessOptions = {
  rows?: SoupRow[];
  isLoading?: boolean;
  isFetching?: boolean;
  isPlaceholderData?: boolean;
  controller?: boolean;
  room?: boolean;
  onPreviewRestored?: () => void;
};

const createHarness = (initial: HarnessOptions = {}) => {
  const stub = splitHandleStub({
    controller: initial.controller ?? true,
    room: initial.room,
  });
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
      splitHandle: stub.handle,
      onPreviewRestored: initial.onPreviewRestored,
    });
  });

  return {
    engagePreview: stub.engagePreview,
    disengagePreview: stub.disengagePreview,
    exitPreviewAsUser: stub.exitPreviewAsUser,
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
    expect(harness.engagePreview).not.toHaveBeenCalled();
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

  it('re-engages preview when entities return after an empty state', async () => {
    const onPreviewRestored = vi.fn();
    const harness = createHarness({ onPreviewRestored });

    await flushEffects();
    harness.setRows([]);
    await flushEffects();
    expect(harness.disengagePreview).toHaveBeenCalledOnce();
    expect(harness.engagePreview).not.toHaveBeenCalled();

    harness.setRows([row()]);
    await flushEffects();
    expect(harness.engagePreview).toHaveBeenCalledOnce();
    expect(onPreviewRestored).toHaveBeenCalledOnce();
    harness.dispose();
  });

  it('waits for the returning result to settle before restoring preview', async () => {
    const onPreviewRestored = vi.fn();
    const harness = createHarness({ onPreviewRestored });

    await flushEffects();
    harness.setRows([]);
    await flushEffects();
    expect(harness.disengagePreview).toHaveBeenCalledOnce();

    // Entities reappear while their fetch is still in flight (e.g. an
    // optimistic insert): the suspension must not restore mid-flight.
    batch(() => {
      harness.setRows([row()]);
      harness.setFetching(true);
    });
    await flushEffects();
    expect(harness.engagePreview).not.toHaveBeenCalled();

    harness.setFetching(false);
    await flushEffects();
    expect(harness.engagePreview).toHaveBeenCalledOnce();
    expect(onPreviewRestored).toHaveBeenCalledOnce();
    harness.dispose();
  });

  it('does not re-engage after the user exits preview mode', async () => {
    const harness = createHarness();

    await flushEffects();
    harness.exitPreviewAsUser();

    harness.setRows([]);
    await flushEffects();
    expect(harness.disengagePreview).not.toHaveBeenCalled();

    harness.setRows([row()]);
    await flushEffects();
    expect(harness.engagePreview).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('does not engage when preview was never on', async () => {
    const harness = createHarness({ rows: [], controller: false });

    await flushEffects();
    harness.setRows([row()]);
    await flushEffects();
    expect(harness.engagePreview).not.toHaveBeenCalled();
    harness.dispose();
  });

  it('consumes the suspension when there is no room to restore', async () => {
    const onPreviewRestored = vi.fn();
    const harness = createHarness({ room: false, onPreviewRestored });

    await flushEffects();
    harness.setRows([]);
    await flushEffects();
    expect(harness.disengagePreview).toHaveBeenCalledOnce();

    harness.setRows([row()]);
    await flushEffects();
    expect(harness.engagePreview).not.toHaveBeenCalled();
    expect(onPreviewRestored).not.toHaveBeenCalled();

    // The consumed suspension cannot re-engage on a later cycle either.
    harness.setRows([]);
    await flushEffects();
    harness.setRows([row()]);
    await flushEffects();
    expect(harness.engagePreview).not.toHaveBeenCalled();
    harness.dispose();
  });
});
