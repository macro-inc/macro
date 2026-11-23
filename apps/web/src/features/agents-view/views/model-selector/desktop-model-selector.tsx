import { t } from '@app/lib/i18n';
import { createCloseOnNavigation } from '@components/app/mobile/close-on-navigation';
import * as Popover from '@kobalte/core/popover';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { createModelSelectorNavigation } from '../../primitives/model-selector-navigation';
import { ModelSelectionList } from '../shared/model-selection-list';
import { ModelSelectorCard } from '../shared/model-selector-card';
import { UnifiedModelTrigger } from '../shared/model-trigger';
import { UnifiedModelTriggerContent } from '../shared/model-trigger-content';

export function DesktopModelSelector() {
  const state = useUnifiedModelSelector();
  let trigger: HTMLButtonElement | undefined;
  const nav = createModelSelectorNavigation(state.onOpenChange, () => trigger);
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
          as={Button}
          variant="ghost"
          size="md"
          disabled={state.disabled}
          aria-label={t('agentControls.modelSelector')}
          class="min-w-0 max-w-[min(18rem,100%)]"
        >
          <UnifiedModelTriggerContent />
        </Popover.Trigger>
      </UnifiedModelTrigger>
      <Popover.Portal>
        <Popover.Content
          ref={content}
          class="portal-scope menu-surface z-modal flex max-h-[min(40rem,var(--kb-popper-content-available-height,80dvh))] max-w-[calc(100vw-1rem)] flex-col rounded-2xl p-0 overflow-hidden outline-none"
          classList={{
            'w-[360px]': nav.page() === 'card',
            'w-[400px]': nav.page() !== 'card',
          }}
          style={{
            'box-shadow':
              'inset 0 0 0 1px var(--color-edge-muted), var(--shadow-menu)',
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const target = nav.page() === 'card' ? 'button' : 'input';
            content
              ?.querySelector<HTMLElement>(target)
              ?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={state.onCloseAutoFocus}
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
