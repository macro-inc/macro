import { fireAndForget } from '@core/util/fireAndForget';
import { type Accessor, createEffect, on } from 'solid-js';
import type { MentionItem } from '../../../utils/mentionsUtils';
import type {
  BucketConfig,
  useMentionsMenuController,
} from './MentionsMenuController';

/** In-process presentation port; provider callbacks never cross the native wire. */
export type NativeMentionPresentation = {
  selection: Accessor<{ id: string; sequence: number } | undefined>;
  more: Accessor<
    { bucketId: string; index: number; sequence: number } | undefined
  >;
  rejected?(
    selection: { id: string; sequence: number },
    reason: 'missing' | 'unavailable'
  ): void;
  publish(snapshot: {
    items: MentionItem[];
    buckets: BucketConfig[];
    viewAll: string | null;
    term: string;
    status(id: string): { isLoading: boolean; error?: string };
  }): void;
};

/** Keep source ranking, category expansion and page-loader ownership in the actual menu. */
export function presentMentionsNatively(
  presentation: NativeMentionPresentation,
  isOpen: Accessor<boolean>,
  term: Accessor<string>,
  status: (id: string) => { isLoading: boolean; error?: string },
  buckets: Accessor<BucketConfig[]>,
  controller: ReturnType<typeof useMentionsMenuController>,
  pick: (item: MentionItem) => Promise<boolean>
) {
  createEffect(() => {
    presentation.publish({
      items: isOpen() ? controller.combinedItems() : [],
      buckets: isOpen() ? buckets() : [],
      viewAll: controller.viewAllMode(),
      term: term(),
      status,
    });
  });
  async function choose(selection: { id: string; sequence: number }) {
    const item = controller
      .combinedItems()
      .find((item) => item.id === selection.id);
    if (!item) {
      presentation.rejected?.(selection, 'missing');
      return;
    }
    if (!(await pick(item))) presentation.rejected?.(selection, 'unavailable');
  }
  createEffect(
    on(presentation.selection, (selection) => {
      if (selection && isOpen())
        fireAndForget(choose(selection), 'native-mentions.select');
    })
  );
  createEffect(
    on(presentation.more, (request) => {
      if (!request || !isOpen() || !controller.getBucket(request.bucketId))
        return;
      controller.viewAll(request.bucketId);
      controller.selectItem(request.index);
    })
  );
}
