import type { ListController } from '@app/components/list';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import type { EntityData } from '@entity/types/entity';
import type { WithNotification } from '@entity/types/notification';
import { debounce } from '@solid-primitives/scheduled';
import { createEffect, onCleanup } from 'solid-js';
import type { InboxDataSourceItem } from './queries/use-inbox-query';

export type InboxPreviewController = {
  request: (entity: WithNotification<EntityData>) => void;
  cancel: () => void;
};

export type UseInboxPreviewOptions = {
  controller: Pick<ListController<InboxDataSourceItem>, 'focus'>;
  handle: Pick<
    SplitHandle,
    'canEngagePreview' | 'engagePreview' | 'isControllerSplit' | 'isViewerSplit'
  >;
  onPreview: (entity: WithNotification<EntityData>) => void;
};

export function useInboxPreview(
  options: UseInboxPreviewOptions
): InboxPreviewController {
  const openPreviewDebounced = debounce(
    (entity: WithNotification<EntityData>) => {
      if (!options.handle.isControllerSplit()) return;

      const row = options.controller.focus.result()?.item;
      if (row?.kind !== 'entity' || row.entity.id !== entity.id) return;

      options.onPreview(entity);
    },
    150
  );
  onCleanup(() => openPreviewDebounced.clear());

  let initialPreviewResolved = false;
  createEffect(() => {
    if (initialPreviewResolved) return;
    if (options.handle.isViewerSplit()) {
      initialPreviewResolved = true;
      return;
    }
    if (!options.handle.canEngagePreview()) return;

    options.controller.focus.clear({ reason: 'programmatic' });
    options.handle.engagePreview();
    if (options.handle.isControllerSplit()) {
      initialPreviewResolved = true;
    }
  });

  return {
    request: (entity) => {
      if (!options.handle.isControllerSplit()) return;

      openPreviewDebounced(entity);
    },
    cancel: openPreviewDebounced.clear,
  };
}
