import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import { ContextMenuContent, SubTrigger } from '@core/component/ContextMenu';
import { lazyNamed } from '@core/util/lazyNamed';
import PaintBrushIcon from '@icon/system/regular/paint-brush.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { createSignal, Index, Show, Suspense } from 'solid-js';
import type { EntityData } from '../../entity/types/entity';

const AppearanceMenuContent = lazyNamed(
  () => import('../appearance-dialog'),
  'AppearanceMenuContent'
);

function AppearanceMenuSkeleton() {
  return (
    <ListSkeleton.Root label={t('common.loading')} class="w-86">
      <div class="flex flex-col gap-3 p-3">
        <div class="flex h-7 items-center justify-between">
          <ListSkeleton.Bar class="h-7 w-32" />
          <ListSkeleton.Bar class="h-3 w-14" />
        </div>
        <ListSkeleton.Bar class="h-8 w-full" />
        <div class="grid grid-cols-7 place-items-center gap-y-1">
          <Index each={Array.from({ length: 13 })}>
            {() => (
              <div class="flex h-8 items-center">
                <ListSkeleton.Bar class="size-4" />
              </div>
            )}
          </Index>
        </div>
      </div>
      <div class="h-76 overflow-hidden border-t border-edge-muted px-3 pb-2">
        <div class="flex h-7 items-center px-1">
          <ListSkeleton.Bar class="h-3 w-20" />
        </div>
        <div class="grid auto-rows-9 grid-cols-9 place-items-center">
          <Index each={Array.from({ length: 63 })}>
            {() => <ListSkeleton.Bar class="size-4 rounded" />}
          </Index>
        </div>
      </div>
      <div class="border-t border-edge-muted px-4 py-1.5">
        <ListSkeleton.Bar class="h-4 w-52" />
      </div>
    </ListSkeleton.Root>
  );
}

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
            <Suspense fallback={<AppearanceMenuSkeleton />}>
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
