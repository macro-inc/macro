import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableEntityAppearance } from '@core/constant/featureFlags';
import { queryClient } from '@queries/client';
import {
  acknowledgeGraphqlRestWrite,
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { createEffect, on, Show } from 'solid-js';
import { refreshSavedViewReaders } from '../saved-views/queries/active-queries';
import { createSaveEntityAppearance } from './queries/appearance';
import { updateEntityAppearance } from './queries/save-entity-appearance';
import {
  AppearanceEditor,
  AppearanceEditorContent,
  type AppearanceEditorProps,
} from './views/appearance-editor';

const saveEntityAppearance = createSaveEntityAppearance({
  queryClient,
  cacheHost: getGraphqlCacheHost,
  update: updateEntityAppearance,
  acknowledgeWrite: acknowledgeGraphqlRestWrite,
  refreshSavedView: (id) => refreshSavedViewReaders(getGraphqlSoupClient(), id),
});

/** Load the editor and its production adapters together, only when opened. */
export function AppearanceDialog(props: Omit<AppearanceEditorProps, 'save'>) {
  const flag = useFeatureFlag(enableEntityAppearance);
  createEffect(
    on(
      () => flag().enabled,
      (enabled) => {
        if (!enabled) props.onOpenChange(false);
      }
    )
  );
  return (
    <Show when={flag().enabled}>
      <AppearanceEditor
        {...props}
        save={(appearance) =>
          saveEntityAppearance(props.entity, appearance, props.isCurrent)
        }
      />
    </Show>
  );
}

/** The same save adapter and picker state inside a menu-owned submenu. */
export function AppearanceMenuContent(
  props: Pick<AppearanceEditorProps, 'entity' | 'userId' | 'isCurrent'> & {
    onClose: () => void;
  }
) {
  return (
    <AppearanceEditorContent
      {...props}
      save={(appearance) =>
        saveEntityAppearance(props.entity, appearance, props.isCurrent)
      }
    />
  );
}
