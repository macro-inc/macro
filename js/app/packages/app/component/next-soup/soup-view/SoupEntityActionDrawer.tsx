import { MobileDrawer } from '@app/component/mobile/MobileDrawer';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { getShareDrawerRecipientInput } from '@core/component/TopBar/ShareButton';
import { triggerFocusInput } from '@core/directive/focusInput';
import { InlineEntity } from '@entity';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import { createSoupEntityActions } from './create-soup-entity-actions';
import { useSoupEntityActionDrawer } from './soup-entity-action-drawer-context';
import { useSoupView } from './soup-view-context';

export function SoupEntityActionDrawer() {
  const panel = useSplitPanelOrThrow();
  const drawerState = useSoupEntityActionDrawer();
  const { activeTab } = useSoupView();
  const { buildActionGroups } = createSoupEntityActions();

  if (!drawerState) {
    console.warn('SoupEntityActionDrawer: no drawer state');
    return null;
  }

  const groups = () => {
    const e = drawerState.entity();
    const s = drawerState.soup();
    if (!e || !s) return [];
    return buildActionGroups(s, [e], {
      activeTab: activeTab(),
      activeListView: panel.handle.content().id,
    });
  };

  return (
    <MobileDrawer
      side="bottom"
      open={drawerState.isOpen()}
      closeOnOutsidePointerStrategy="pointerdown"
      onOpenChange={(v) => {
        if (!v) drawerState.close();
      }}
      preventScroll={false}
      preventScrollbarShift={false}
      restoreFocus={false}
      noOutsidePointerEvents={false}
    >
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content aria-label="Entity actions">
          <MobileDrawer.Handle />

          {/* Entity preview */}
          <Show when={drawerState.entity()}>
            {(e) => (
              <div class="px-4 pb-4 shrink-0 text-sm font-medium text-ink-muted">
                <InlineEntity entity={e()} />
              </div>
            )}
          </Show>

          {/* Action groups */}
          <For each={groups()}>
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
                        class={cn(
                          'flex items-center gap-3 px-4 py-3 text-sm hover:bg-hover hover-transition-bg text-left not-last:mb-px bg-surface',
                          action.destructive ? 'text-failure-ink' : 'text-ink'
                        )}
                        onClick={async (e: MouseEvent) => {
                          if (action.id === 'share') {
                            triggerFocusInput(
                              getShareDrawerRecipientInput,
                              e.currentTarget as HTMLElement
                            );
                          }
                          await action.onClick();
                          drawerState.close();
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
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}
