import { t } from '@app/lib/i18n';
import { createCloseOnNavigation } from '@components/app/mobile/close-on-navigation';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import * as Popover from '@kobalte/core/popover';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { createModelSelectorNavigation } from '../../primitives/model-selector-navigation';
import { ModelSelectionList } from '../shared/model-selection-list';
import { ModelSelectorCard } from '../shared/model-selector-card';
import { UnifiedModelTriggerContent } from '../shared/model-trigger-content';

export function MobileModelSelector() {
  const state = useUnifiedModelSelector();
  let trigger: HTMLButtonElement | undefined;
  const nav = createModelSelectorNavigation(state.onOpenChange, () => trigger);
  const sheetOpen = () => nav.open() && nav.page() !== 'card';
  const [sheetPresent, setSheetPresent] = createSignal(false);
  const openSheet = (page: 'list' | 'agentModels') => {
    setSheetPresent(true);
    nav.setPage(page);
  };
  createCloseOnNavigation({
    open: nav.open,
    close: () => nav.changeOpen(false),
  });
  let card: HTMLDivElement | undefined;
  let sheet: HTMLDivElement | undefined;
  return (
    <Popover.Root
      open={nav.open() && !sheetPresent()}
      onOpenChange={(open) => {
        if (!open && sheetPresent()) return;
        nav.changeOpen(open);
      }}
      placement="top-end"
      gutter={6}
    >
      <Popover.Trigger
        ref={trigger}
        as={Button}
        variant="ghost"
        size="md"
        disabled={state.disabled}
        aria-label={t('agentControls.modelSelector')}
        class="min-w-0 max-w-full"
        onPointerDown={(event: PointerEvent) => event.preventDefault()}
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
      >
        <UnifiedModelTriggerContent />
      </Popover.Trigger>
      <Popover.Portal>
        <Show when={nav.open() && !sheetPresent()}>
          <div
            data-model-selector-overlay
            onClick={() => nav.changeOpen(false)}
            class="portal-scope fixed inset-0 z-modal"
            style={{ 'background-color': 'var(--color-overlay)' }}
            aria-hidden="true"
          />
        </Show>
        <Show when={!sheetPresent()}>
          <Popover.Content
            ref={card}
            class="portal-scope menu-surface z-modal w-[358px] max-w-[calc(100vw-var(--safe-left,0px)-var(--safe-right,0px)-32px)] rounded-[28px] p-0 outline-none"
            style={{
              'box-shadow':
                'inset 0 0 0 1px var(--color-edge), var(--shadow-menu)',
            }}
            onCloseAutoFocus={(event) => {
              if (sheetPresent()) event.preventDefault();
              else state.onCloseAutoFocus?.(event);
            }}
          >
            <Popover.Title class="sr-only">
              {t('agentControls.modelSelector')}
            </Popover.Title>
            <ModelSelectorCard
              mobile
              onSelect={() => openSheet('list')}
              onModels={() => openSheet('agentModels')}
            />
          </Popover.Content>
        </Show>
      </Popover.Portal>
      <MobileDrawer
        restoreFocus
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          nav.escape();
        }}
        open={sheetOpen()}
        onOpenChange={(open) => {
          if (!open && sheetOpen()) nav.changeOpen(false);
        }}
        onInitialFocus={(event) => {
          event.preventDefault();
          if (!sheet?.contains(document.activeElement))
            sheet?.focus({ preventScroll: true });
        }}
        onFinalFocus={(event) => {
          event.preventDefault();
          // Corvu retains its focus trap for the exit transition. Mount the
          // returning card only after that trap has retired.
          setSheetPresent(false);
          if (nav.open()) {
            queueMicrotask(() => {
              if (nav.open() && card?.isConnected)
                card.querySelector<HTMLButtonElement>('button')?.focus({
                  preventScroll: true,
                });
            });
          } else if (state.onCloseAutoFocus) state.onCloseAutoFocus(event);
          else if (trigger?.isConnected) trigger.focus({ preventScroll: true });
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay
            style={{ 'background-color': 'var(--color-overlay)' }}
          />
          <MobileDrawer.Content
            ref={sheet}
            targetHeight={90}
            tabIndex={-1}
            maxHeight={90}
            opaque
            class="rounded-[44px]"
            aria-label={t('agentControls.modelSelector')}
          >
            <MobileDrawer.Handle class="pt-3 pb-4" />
            <MobileDrawer.ScrollBody class="gap-0 p-0">
              <ModelSelectionList
                navigation={nav}
                mobile
                onPick={() => nav.changeOpen(false)}
                onBack={nav.back}
              />
            </MobileDrawer.ScrollBody>
          </MobileDrawer.Content>
        </MobileDrawer.Portal>
      </MobileDrawer>
    </Popover.Root>
  );
}
