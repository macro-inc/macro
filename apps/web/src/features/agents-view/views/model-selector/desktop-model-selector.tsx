import { t } from '@app/lib/i18n';
import { createCloseOnNavigation } from '@components/app/mobile/close-on-navigation';
import { Popover } from '@ui';
import { onCleanup, Show, untrack } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { createModelSelectorNavigation } from '../../primitives/model-selector-navigation';
import { ModelSelectionList } from '../shared/model-selection-list';
import { ModelSelectorCard } from '../shared/model-selector-card';
import { UnifiedModelTrigger } from '../shared/model-trigger';
import { UnifiedModelTriggerContent } from '../shared/model-trigger-content';

export function DesktopModelSelector() {
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
  onCleanup(() => {
    disposed = true;
    state.onFocusScopeChange?.(false);
  });
  createCloseOnNavigation({
    open: nav.open,
    close: () => nav.changeOpen(false),
  });
  let content: HTMLDivElement | undefined;
  const changePage = (page: Parameters<typeof nav.setPage>[0]) => {
    // The clicked page button is about to unmount. Keep focus on the stable
    // dialog so its dismissal layer never sees a detached focused target.
    content?.focus({ preventScroll: true });
    nav.setPage(page);
    queueMicrotask(() => {
      if (!nav.open()) return;
      content
        ?.querySelector<HTMLElement>(page === 'card' ? 'button' : 'input')
        ?.focus({ preventScroll: true });
    });
  };
  const navigation = { ...nav, setPage: changePage };
  const backToCard = () => changePage('card');
  const goBack = () =>
    changePage(
      nav.page() === 'all' || nav.page() === 'agents' ? 'list' : 'card'
    );
  return (
    <Popover.Root
      open={nav.open()}
      onOpenChange={nav.changeOpen}
      placement="bottom-end"
      flip="top-end"
      gutter={6}
    >
      <UnifiedModelTrigger menuOpen={nav.open()}>
        <Popover.Trigger
          ref={trigger}
          variant="ghost"
          size="xs"
          disabled={state.disabled}
          aria-label={t('agentControls.modelSelector')}
          class="min-w-0 max-w-full"
        >
          <UnifiedModelTriggerContent />
        </Popover.Trigger>
      </UnifiedModelTrigger>
      <Popover.Portal>
        <Popover.Content
          ref={content}
          class="flex min-w-64 max-w-[calc(100vw-2rem)] flex-col overflow-hidden"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            // Kobalte calls this inside its focus-scope effect. A page read
            // must not recreate that scope and restore focus to the composer.
            untrack(() => {
              const target = nav.page() === 'card' ? 'button' : 'input';
              content
                ?.querySelector<HTMLElement>(target)
                ?.focus({ preventScroll: true });
            });
          }}
          onCloseAutoFocus={(event) => {
            if (disposed || nav.open()) {
              event.preventDefault();
              return;
            }
            state.onCloseAutoFocus?.(event);
            // Release the composer only after the library restores focus.
            queueMicrotask(() => {
              if (!disposed && !nav.open()) state.onFocusScopeChange?.(false);
            });
          }}
          onEscapeKeyDown={(event) => {
            if (nav.page() !== 'card') {
              event.preventDefault();
              backToCard();
            }
          }}
        >
          <Popover.Title class="sr-only">
            {t('agentControls.modelSelector')}
          </Popover.Title>
          <Show
            when={nav.page() === 'card'}
            fallback={
              <ModelSelectionList
                navigation={navigation}
                onPick={backToCard}
                onBack={goBack}
              />
            }
          >
            <ModelSelectorCard
              onSelect={() => changePage('list')}
              onModels={() => changePage('agentModels')}
            />
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
