import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import {
  ContextMenuContent,
  MenuItem,
  SubTrigger,
} from '@core/component/ContextMenu';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { enableEntityAppearance } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { lazyNamed } from '@core/util/lazyNamed';
import PaintBrushIcon from '@icon/system/regular/paint-brush.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { createSignal, Show, Suspense } from 'solid-js';
import type { EntityData } from '../entity/types/entity';
import { useChangeEntityIcon } from './entity-appearance';

const AppearanceMenuContent = lazyNamed(
  () => import('./appearance-dialog'),
  'AppearanceMenuContent'
);

/** Menus own desktop picker disclosure; mobile retains the touch-friendly sheet. */
export function EntityAppearanceMenu(props: { entity: EntityData }) {
  const userId = useUserId();
  const flag = useFeatureFlag(enableEntityAppearance);
  const changeIcon = useChangeEntityIcon();
  const [open, setOpen] = createSignal(false);
  return (
    <Show when={flag().enabled}>
      <Show
        when={!isMobile()}
        fallback={
          <MenuItem
            text={t('appearance.title')}
            icon={PaintBrushIcon}
            onClick={() => changeIcon(props.entity)}
          />
        }
      >
        <ContextMenu.Sub open={open()} onOpenChange={setOpen}>
          <SubTrigger text={t('appearance.title')} icon={PaintBrushIcon} />
          <ContextMenuContent
            submenu
            class="p-0 max-h-[calc(100dvh-24px)] overflow-y-auto"
          >
            <Show when={open() && userId()} keyed>
              {(actor) => (
                <div
                  onKeyDown={(event) => {
                    // The picker owns search and grid keys; Escape still dismisses the submenu.
                    if (event.key !== 'Escape') event.stopPropagation();
                  }}
                >
                  <Suspense
                    fallback={
                      <div class="w-86 p-4">
                        <LoadingSpinner />
                      </div>
                    }
                  >
                    <AppearanceMenuContent
                      entity={props.entity}
                      userId={actor}
                      isCurrent={() => flag().enabled && userId() === actor}
                      onClose={() => setOpen(false)}
                    />
                  </Suspense>
                </div>
              )}
            </Show>
          </ContextMenuContent>
        </ContextMenu.Sub>
      </Show>
    </Show>
  );
}
