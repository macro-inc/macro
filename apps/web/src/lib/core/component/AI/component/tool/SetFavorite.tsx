import { ItemPreview } from '@core/component/ItemPreview';
import Star from '@icon/system/regular/star.svg';
import type { FavoritableEntityType } from '@service-cognition/generated/tools/types';
import type { ItemType } from '@service-storage/client';
import { Suspense } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const ITEM_TYPES: Record<FavoritableEntityType, ItemType> = {
  document: 'document',
  project: 'project',
  chat: 'chat',
  channel: 'channel',
  email: 'email',
  call: 'call',
  crm_company: 'crm_company',
  crm_contact: 'crm_contact',
};

export const setFavoriteHandler = createToolRenderer({
  name: 'SetFavorite',
  render: (ctx) => {
    const verb = () => {
      if (ctx.tool.data.favorite)
        return ctx.response ? 'Favorited' : 'Favorite';
      return ctx.response ? 'Unfavorited' : 'Unfavorite';
    };

    return (
      <BaseTool icon={Star} renderContext={ctx.renderContext} type="call">
        <div class="min-w-0 flex-1">
          {verb()}{' '}
          <Suspense>
            <ItemPreview
              class="inline-flex align-middle ring-0"
              id={ctx.tool.data.entityId}
              type={ITEM_TYPES[ctx.tool.data.entityType]}
            />
          </Suspense>
        </div>
      </BaseTool>
    );
  },
});
