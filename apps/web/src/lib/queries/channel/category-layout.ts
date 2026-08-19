import type { ChannelCategoryLayout } from '@service-storage/client';

export type ChannelCategoryIntent =
  | { type: 'add-category'; id: string; name: string }
  | { type: 'rename-category'; categoryId: string; name: string }
  | { type: 'delete-category'; categoryId: string }
  | {
      type: 'move-channel';
      channelId: string;
      categoryId: string | null;
      targetIndex?: number;
    }
  | { type: 'move-category'; categoryId: string; targetIndex: number };

export function applyChannelCategoryIntent(
  layout: ChannelCategoryLayout,
  intent: ChannelCategoryIntent
): ChannelCategoryLayout {
  switch (intent.type) {
    case 'add-category':
      return {
        ...layout,
        categories: [
          ...layout.categories,
          { id: intent.id, name: intent.name },
        ],
      };
    case 'rename-category':
      return {
        ...layout,
        categories: layout.categories.map((category) =>
          category.id === intent.categoryId
            ? { ...category, name: intent.name }
            : category
        ),
      };
    case 'delete-category':
      return deleteCategory(layout, intent.categoryId);
    case 'move-channel':
      return moveChannel(
        layout,
        intent.channelId,
        intent.categoryId,
        intent.targetIndex
      );
    case 'move-category':
      return moveCategory(layout, intent.categoryId, intent.targetIndex);
  }
}

type PendingIntent = { id: number; intent: ChannelCategoryIntent };

/** Serializes persistence while always deriving requests from confirmed state. */
export class ChannelCategoryMutationQueue {
  private confirmed: ChannelCategoryLayout;
  private pending: PendingIntent[] = [];
  private tail = Promise.resolve();
  private nextId = 0;
  private lastPublished: ChannelCategoryLayout | undefined;
  private disposed = false;

  constructor(
    initial: ChannelCategoryLayout,
    private readonly persist: (
      layout: ChannelCategoryLayout
    ) => Promise<ChannelCategoryLayout>,
    private readonly refetch?: () => Promise<ChannelCategoryLayout>,
    private readonly onChange?: (layout: ChannelCategoryLayout) => void,
    private readonly isActive: () => boolean = () => true
  ) {
    this.confirmed = initial;
  }

  optimistic(): ChannelCategoryLayout {
    return this.pending.reduce(
      (current, item) => applyChannelCategoryIntent(current, item.intent),
      this.confirmed
    );
  }

  /** Absorb an authoritative query refresh and replay pending local intents. */
  absorbConfirmed(layout: ChannelCategoryLayout) {
    if (!this.active()) return;
    if (layout === this.lastPublished) return;
    if (!this.acceptConfirmed(layout)) return;
    this.publish();
  }

  enqueue(intent: ChannelCategoryIntent): Promise<ChannelCategoryLayout> {
    if (!this.active()) return Promise.reject(new StaleCategorySessionError());
    const item = { id: ++this.nextId, intent };
    this.pending.push(item);
    this.publish();
    const execute = async () => {
      this.assertActive();
      const request = applyChannelCategoryIntent(this.confirmed, item.intent);
      try {
        const confirmed = await this.persist(request);
        this.assertActive();
        this.remove(item.id);
        this.acceptConfirmed(confirmed);
        this.publish();
        return this.confirmed;
      } catch (error) {
        this.remove(item.id);
        if (!this.active()) throw new StaleCategorySessionError();
        if (isConflict(error) && this.refetch) {
          try {
            const confirmed = await this.refetch();
            this.assertActive();
            this.acceptConfirmed(confirmed);
          } catch (refetchError) {
            // The rejected optimistic intent must disappear even when recovery
            // cannot obtain a newer authoritative layout.
            this.publish();
            throw refetchError;
          }
        }
        this.publish();
        throw error;
      }
    };
    const result = this.tail.then(execute, execute);
    this.tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  /** Permanently cancel this authentication generation and forget its intents. */
  dispose() {
    this.disposed = true;
    this.pending = [];
    this.lastPublished = undefined;
  }

  private remove(id: number) {
    this.pending = this.pending.filter((item) => item.id !== id);
  }

  private acceptConfirmed(layout: ChannelCategoryLayout): boolean {
    this.assertActive();
    if (layout.revision < this.confirmed.revision) return false;
    this.confirmed = layout;
    return true;
  }

  private publish() {
    if (!this.active()) return;
    this.lastPublished = this.optimistic();
    this.onChange?.(this.lastPublished);
  }

  private active() {
    return !this.disposed && this.isActive();
  }

  private assertActive() {
    if (!this.active()) throw new StaleCategorySessionError();
  }
}

/** Identifies work cancelled by an authentication-generation transition. */
export class StaleCategorySessionError extends Error {
  constructor() {
    super('Channel category authentication generation changed');
    this.name = 'StaleCategorySessionError';
  }
}

function isConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as {
    status?: number;
    response?: { status?: number };
    errors?: { code?: string }[];
  };
  return (
    candidate.status === 409 ||
    candidate.response?.status === 409 ||
    candidate.errors?.some((item) => item.code === 'CONFLICT') === true
  );
}

/** Move a channel to a category (or Uncategorized) without disturbing other order. */
export function moveChannel(
  layout: ChannelCategoryLayout,
  channelId: string,
  categoryId: string | null,
  targetIndex?: number
): ChannelCategoryLayout {
  const remaining = layout.placements.filter(
    (item) => item.channel_id !== channelId
  );
  const destinationIndexes = remaining.flatMap((item, index) =>
    item.category_id === categoryId ? [index] : []
  );
  const indexInCategory = Math.max(
    0,
    Math.min(
      targetIndex ?? destinationIndexes.length,
      destinationIndexes.length
    )
  );
  const insertAt =
    destinationIndexes[indexInCategory] ??
    (destinationIndexes.at(-1) !== undefined
      ? destinationIndexes.at(-1)! + 1
      : remaining.length);
  return {
    ...layout,
    placements: remaining.toSpliced(insertAt, 0, {
      channel_id: channelId,
      category_id: categoryId,
    }),
  };
}

/** Reorder a category without dropping empty categories. */
export function moveCategory(
  layout: ChannelCategoryLayout,
  categoryId: string,
  targetIndex: number
): ChannelCategoryLayout {
  const category = layout.categories.find((item) => item.id === categoryId);
  if (!category) return layout;
  const remaining = layout.categories.filter((item) => item.id !== categoryId);
  const index = Math.max(0, Math.min(targetIndex, remaining.length));
  return { ...layout, categories: remaining.toSpliced(index, 0, category) };
}

/** Delete a category while preserving its channels as Uncategorized. */
export function deleteCategory(
  layout: ChannelCategoryLayout,
  categoryId: string
): ChannelCategoryLayout {
  return {
    ...layout,
    categories: layout.categories.filter(
      (category) => category.id !== categoryId
    ),
    placements: layout.placements.map((placement) =>
      placement.category_id === categoryId
        ? { ...placement, category_id: null }
        : placement
    ),
  };
}
