import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { type EntityData, InlineEntity } from '@entity';
import { cn } from '@ui';
import { For, Show } from 'solid-js';

export type SoupEntityDrawerAction = {
  id: string;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
};

export type SoupEntityDrawerActionGroup = {
  items: readonly SoupEntityDrawerAction[];
};

type SoupEntityActionDrawerProps = {
  entity: EntityData | undefined;
  groups: readonly SoupEntityDrawerActionGroup[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beforeAction?: (
    action: SoupEntityDrawerAction,
    trigger: HTMLButtonElement
  ) => void;
};

/** Mobile drawer presentation shared by Soup-backed entity lists. */
export function SoupEntityActionDrawer(props: SoupEntityActionDrawerProps) {
  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      closeOnOutsidePointerStrategy="pointerdown"
      onOpenChange={props.onOpenChange}
      preventScroll={false}
      preventScrollbarShift={false}
      restoreFocus={false}
      noOutsidePointerEvents={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="Entity actions">
          <MobileDrawer.Handle />

          <Show when={props.entity}>
            {(entity) => (
              <div class="px-4 pb-4 shrink-0 text-sm font-medium text-ink-muted">
                <InlineEntity entity={entity()} />
              </div>
            )}
          </Show>

          <MobileDrawer.ScrollBody>
            <For each={props.groups}>
              {(group, groupIndex) => (
                <>
                  <Show when={groupIndex() > 0}>
                    <div class="mt-3" />
                  </Show>
                  <MobileDrawer.Section class="flex flex-col shrink-0">
                    <For each={group.items}>
                      {(action) => (
                        <button
                          type="button"
                          disabled={action.disabled}
                          class={cn(
                            'flex items-center gap-3 px-4 py-3 text-sm hover:bg-hover hover-transition-bg text-left not-last:mb-px bg-surface',
                            action.destructive
                              ? 'text-failure-ink'
                              : 'text-ink',
                            action.disabled && 'opacity-50'
                          )}
                          onClick={async (event) => {
                            props.beforeAction?.(action, event.currentTarget);
                            await action.onClick();
                            props.onOpenChange(false);
                          }}
                        >
                          {action.label}
                        </button>
                      )}
                    </For>
                  </MobileDrawer.Section>
                </>
              )}
            </For>
          </MobileDrawer.ScrollBody>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
