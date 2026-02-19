import type { Accessor, Signal } from 'solid-js';
import { createSignal } from 'solid-js';
import { createLazyMemo } from '@solid-primitives/memo';
import type { MentionItem } from '../../../utils/mentionsUtils';

export interface BucketConfig<T extends MentionItem = MentionItem> {
  id: string;
  label: string;
  getData: () => T[];
  getFullCount: () => number;
}

/**
 * view mode
 * - null: show all categories with limited items
 * - string: show all items for the specified category
 */
export type ViewAllMode = string | null;

/** the currently selected category id, or null if in view-all mode */
export type SelectedCategory = string | null;

/** result of bin computation - how many items to show per bucket */
export type MentionBins = Record<string, number>;

export class MentionsMenuController {
  private buckets: Accessor<BucketConfig[]>;
  private maxItems: number;
  private ignoredIds: Accessor<string[]> = () => [];
  private selectedIndexSignal: Signal<number>;
  private viewAllModeSignal: Signal<ViewAllMode>;

  constructor(
    buckets: Accessor<BucketConfig[]>,
    options: {
      maxItems?: number;
      ignoredIds?: Accessor<string[]>;
    } = {}
  ) {
    this.buckets = buckets;
    this.maxItems = options.maxItems ?? 8;
    this.ignoredIds = options.ignoredIds ?? (() => []);

    this.selectedIndexSignal = createSignal(0);
    this.viewAllModeSignal = createSignal<ViewAllMode>(null);
  }

  get selectedIndex(): Accessor<number> {
    return this.selectedIndexSignal[0];
  }

  get setSelectedIndex() {
    return this.selectedIndexSignal[1];
  }

  get viewAllMode(): Accessor<ViewAllMode> {
    return this.viewAllModeSignal[0];
  }

  get setViewAllMode() {
    return this.viewAllModeSignal[1];
  }

  rawBins = createLazyMemo((): MentionBins => {
    const buckets = this.buckets();
    if (!buckets) return {};

    const bins: MentionBins = {};
    const seenIds = new Set<string>(this.ignoredIds());

    // Count items per bucket, excluding items already seen in earlier buckets
    buckets.forEach((config) => {
      let count = 0;
      for (const item of config.getData()) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          count++;
        }
      }
      bins[config.id] = count;
    });

    return bins;
  });

  bins = createLazyMemo((): MentionBins => {
    return this.computeBins(this.rawBins(), this.maxItems);
  });

  combinedItems = createLazyMemo((): MentionItem[] => {
    const buckets = this.buckets();
    if (!buckets) return [];

    const currentViewAllMode = this.viewAllMode();
    const seenIds = new Set<string>(this.ignoredIds());

    if (currentViewAllMode) {
      const bucket = buckets.find((b) => b.id === currentViewAllMode);
      if (!bucket) return [];

      return bucket.getData().filter((item) => {
        if (seenIds.has(item.id)) return false;
        return true;
      });
    }

    const result: MentionItem[] = [];
    const currentBins = this.bins();

    buckets.forEach((config) => {
      const limit = currentBins[config.id] || 0;
      if (limit === 0) return;

      let added = 0;
      for (const item of config.getData()) {
        if (added >= limit) break;
        if (seenIds.has(item.id)) continue;
        seenIds.add(item.id);
        result.push(item);
        added++;
      }
    });

    return result;
  });

  selectedCategory = createLazyMemo((): SelectedCategory => {
    if (this.viewAllMode()) return null;

    const buckets = this.buckets();
    if (!buckets) return null;

    const index = this.selectedIndex();
    const currentBins = this.bins();
    let currentIndex = 0;

    for (const config of buckets) {
      const count = currentBins[config.id] || 0;
      if (count > 0) {
        if (index < currentIndex + count) {
          return config.id;
        }
        currentIndex += count;
      }
    }

    return null;
  });

  selectedItem = createLazyMemo((): MentionItem | null => {
    const items = this.combinedItems();
    if (!items) return null;
    const index = this.selectedIndex();
    return items[index] ?? null;
  });

  totalItemCount = createLazyMemo((): number => {
    const items = this.combinedItems();
    return items?.length ?? 0;
  });

  selectNext(): void {
    const items = this.combinedItems();
    if (!items || items.length === 0) return;
    const current = this.selectedIndex();
    const next = current + 1;
    this.setSelectedIndex(next >= items.length ? 0 : next);
  }

  selectPrev(): void {
    const items = this.combinedItems();
    if (!items || items.length === 0) return;
    const current = this.selectedIndex();
    const prev = current - 1;
    this.setSelectedIndex(prev < 0 ? items.length - 1 : prev);
  }

  selectItem(index: number): void {
    const items = this.combinedItems();
    if (!items) return;
    if (index >= 0 && index < items.length) {
      this.setSelectedIndex(index);
    }
  }

  selectNextCategory(): void {
    if (this.viewAllMode()) {
      this.selectNext();
      return;
    }

    const currentCategory = this.selectedCategory();
    const currentBins = this.bins();
    const configs = this.buckets();
    if (!configs) return;

    if (!currentCategory) {
      this.setSelectedIndex(0);
      return;
    }

    const currentCategoryIndex = configs.findIndex(
      (c) => c.id === currentCategory
    );

    if (currentCategoryIndex === -1) {
      this.setSelectedIndex(0);
      return;
    }

    let nextCategoryIndex = currentCategoryIndex + 1;
    while (nextCategoryIndex < configs.length) {
      const nextConfig = configs[nextCategoryIndex];
      if (currentBins[nextConfig.id] > 0) {
        let offset = 0;
        for (let i = 0; i < nextCategoryIndex; i++) {
          offset += currentBins[configs[i].id] || 0;
        }
        this.setSelectedIndex(offset);
        return;
      }
      nextCategoryIndex++;
    }

    this.setSelectedIndex(0);
  }

  selectPrevCategory(): void {
    if (this.viewAllMode()) {
      this.selectPrev();
      return;
    }

    const currentCategory = this.selectedCategory();
    const currentBins = this.bins();
    const configs = this.buckets();
    if (!configs) return;

    if (!currentCategory) {
      this.setSelectedIndex(this.totalItemCount() - 1);
      return;
    }

    const currentCategoryIndex = configs.findIndex(
      (c) => c.id === currentCategory
    );

    if (currentCategoryIndex === -1) {
      this.setSelectedIndex(0);
      return;
    }

    let prevCategoryIndex = currentCategoryIndex - 1;
    while (prevCategoryIndex >= 0) {
      const prevConfig = configs[prevCategoryIndex];
      if (currentBins[prevConfig.id] > 0) {
        // Jump to first item of previous category
        let offset = 0;
        for (let i = 0; i < prevCategoryIndex; i++) {
          offset += currentBins[configs[i].id] || 0;
        }
        this.setSelectedIndex(offset);
        return;
      }
      prevCategoryIndex--;
    }

    let lastOffset = 0;
    for (let i = 0; i < configs.length - 1; i++) {
      lastOffset += currentBins[configs[i].id] || 0;
    }
    this.setSelectedIndex(lastOffset);
  }

  viewAll(bucketId: string): void {
    this.setViewAllMode(bucketId);
    this.setSelectedIndex(0);
  }

  exitViewAll(): void {
    this.setViewAllMode(null);
    this.setSelectedIndex(0);
  }

  toggleViewAllForCurrentCategory(): void {
    const category = this.selectedCategory();
    if (category) {
      this.viewAll(category);
    }
  }

  isViewAllMode(): boolean {
    return this.viewAllMode() !== null;
  }

  hasOnlyOneCategory = createLazyMemo((): boolean => {
    const configs = this.buckets();
    if (!configs) return false;
    const nonEmptyCount = configs.filter(
      (config) => config.getFullCount() > 0
    ).length;
    return nonEmptyCount === 1;
  });

  reset(): void {
    this.setSelectedIndex(0);
    this.setViewAllMode(null);
  }

  getBucket(id: string): BucketConfig | undefined {
    const buckets = this.buckets();
    if (!buckets) return undefined;
    return buckets.find((b) => b.id === id);
  }

  getAllBuckets(): BucketConfig[] {
    return this.buckets() ?? [];
  }

  canViewAllForCategory(categoryId: string): boolean {
    const currentBins = this.bins();
    const rawBins = this.rawBins();
    const abbreviatedCount = currentBins[categoryId] || 0;
    const fullCount = rawBins[categoryId] || 0;
    return fullCount > abbreviatedCount;
  }

  private computeBins(rawBins: MentionBins, maxItems: number): MentionBins {
    const total = Object.values(rawBins).reduce((sum, count) => sum + count, 0);

    // If total items fit in max, no scaling needed
    if (total <= maxItems) {
      return { ...rawBins };
    }

    // Allocate items proportionally, ensuring each non-empty bin gets at least 1
    const scaled: MentionBins = {};

    const nonEmptyBins = Object.entries(rawBins).filter(
      ([_, count]) => count > 0
    );

    let allocated = 0;

    // First pass: give each non-empty bin at least 1 item
    for (const [key, count] of nonEmptyBins) {
      if (count > 0) {
        scaled[key] = 1;
        allocated += 1;
      }
    }

    // Second pass: distribute remaining slots proportionally
    const remaining = maxItems - allocated;

    if (remaining > 0) {
      const nonEmptyTotal = nonEmptyBins.reduce((sum, [_, c]) => sum + c, 0);
      const remainders: Array<{ key: string; remainder: number }> = [];
      let totalFloorsAdded = 0;

      for (const [key, count] of nonEmptyBins) {
        const proportion = count / nonEmptyTotal;
        const raw = proportion * remaining;
        const floor = Math.floor(raw);
        const remainder = raw - floor;

        scaled[key] = (scaled[key] || 0) + floor;
        totalFloorsAdded += floor;
        remainders.push({ key, remainder });
      }

      // Distribute leftover items to bins with largest remainders
      const leftover = remaining - totalFloorsAdded;
      const sorted = remainders.sort((a, b) => b.remainder - a.remainder);

      for (let i = 0; i < leftover && i < sorted.length; i++) {
        const key = sorted[i].key;
        scaled[key] = (scaled[key] || 0) + 1;
      }
    }

    // Ensure we don't exceed actual bin counts
    for (const [key, count] of Object.entries(scaled)) {
      scaled[key] = Math.min(count, rawBins[key] || 0);
    }

    return scaled;
  }
}

export function useMentionsMenuController(
  buckets: Accessor<BucketConfig[]>,
  options: {
    maxItems?: number;
    ignoredIds?: Accessor<string[]>;
  } = {}
): MentionsMenuController {
  return new MentionsMenuController(buckets, {
    maxItems: options.maxItems,
    ignoredIds: options.ignoredIds,
  });
}
