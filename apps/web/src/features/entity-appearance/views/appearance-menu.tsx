import { t } from '@app/lib/i18n';
import { ContextMenuContent, SubTrigger } from '@core/component/ContextMenu';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import { lazyNamed } from '@core/util/lazyNamed';
import PaintBrushIcon from '@icon/system/regular/paint-brush.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { createSignal, Show, Suspense } from 'solid-js';
import type { EntityData } from '../../entity/types/entity';

const AppearanceMenuContent = lazyNamed(
  () => import('../appearance-dialog'),
  'AppearanceMenuContent'
);

export function DesktopAppearanceMenu(props: {
  entity: EntityData;
  userId: string;
  isCurrent: () => boolean;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <ContextMenu.Sub open={open()} onOpenChange={setOpen}>
      <SubTrigger text={t('appearance.title')} icon={PaintBrushIcon} />
      <ContextMenuContent
        submenu
        class="p-0 max-h-[calc(100dvh-24px)] overflow-y-auto"
      >
        <Show when={open()}>
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
                userId={props.userId}
                isCurrent={props.isCurrent}
                onClose={() => setOpen(false)}
              />
            </Suspense>
          </div>
        </Show>
      </ContextMenuContent>
    </ContextMenu.Sub>
  );
}
