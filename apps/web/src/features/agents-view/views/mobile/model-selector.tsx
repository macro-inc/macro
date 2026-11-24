import { t } from '@app/lib/i18n';
import { createCloseOnNavigation } from '@components/app/mobile/close-on-navigation';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Popover } from '@ui';
import { createSignal, onCleanup, Show } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { createModelSelectorNavigation } from '../../primitives/model-selector-navigation';
import { ModelSelectionList } from '../shared/model-selection-list';
import { ModelSelectorCard } from '../shared/model-selector-card';
import { UnifiedModelTriggerContent } from '../shared/model-trigger-content';

export function MobileModelSelector() {
  const state = useUnifiedModelSelector();
  let trigger: HTMLButtonElement | undefined;
  const nav = createModelSelectorNavigation(
    (open) => {
      if (open) state.onFocusScopeChange?.(true);
      state.onOpenChange?.(open);
    },
    () => trigger
  );
  let disposed = false;
  const releaseFocusScope = () =>
    queueMicrotask(() => {
      if (!disposed && !nav.open()) state.onFocusScopeChange?.(false);
    });
  onCleanup(() => {
    disposed = true;
    state.onFocusScopeChange?.(false);
  });
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
        variant="ghost"
        size="xs"
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
          <Popover.Overlay
            data-model-selector-overlay
            onClick={() => nav.changeOpen(false)}
          />
        </Show>
        <Show when={!sheetPresent()}>
          <Popover.Content
            ref={card}
            class="min-w-64 max-w-[calc(100vw-2rem)]"
            onCloseAutoFocus={(event) => {
              if (disposed || sheetPresent() || nav.open())
                event.preventDefault();
              else {
                state.onCloseAutoFocus?.(event);
                releaseFocusScope();
              }
            }}
          >
            <Popover.Title class="sr-only">
              {t('agentControls.modelSelector')}
            </Popover.Title>
            <ModelSelectorCard
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
          releaseFocusScope();
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay />
          <MobileDrawer.Content
            ref={sheet}
            tabIndex={-1}
            aria-label={t('agentControls.modelSelector')}
          >
            <MobileDrawer.Handle />
            <MobileDrawer.ScrollBody>
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
