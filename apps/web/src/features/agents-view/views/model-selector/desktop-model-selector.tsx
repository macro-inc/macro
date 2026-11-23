import { t } from '@app/lib/i18n';
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
  const nav = createModelSelectorNavigation(state.onOpenChange);
  let content: HTMLDivElement | undefined;
  const backToCard = () => {
    nav.setPage('card');
    queueMicrotask(() =>
      content?.querySelector<HTMLButtonElement>('button')?.focus()
    );
  };
  const goBack = () => {
    if (nav.page() === 'list') backToCard();
    else nav.back();
  };
  return (
    <Popover.Root
      open={nav.open()}
      onOpenChange={nav.changeOpen}
      placement="top-end"
      gutter={6}
    >
      <UnifiedModelTrigger menuOpen={nav.open()}>
        <Popover.Trigger
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
          class="portal-scope menu-surface z-modal w-[360px] max-w-[calc(100vw-1rem)] rounded-2xl overflow-hidden outline-none"
          style={{
            'box-shadow':
              'inset 0 0 0 1px var(--color-edge-muted), 0 16px 40px #00000040',
          }}
          onCloseAutoFocus={state.onCloseAutoFocus}
          onEscapeKeyDown={(event) => {
            if (nav.page() !== 'card') {
              event.preventDefault();
              goBack();
            }
          }}
        >
          <Popover.Title class="sr-only">
            {t('agentControls.modelSelector')}
          </Popover.Title>
          <Show
            when={nav.page() === 'card'}
            fallback={
              <div class="flex max-h-[min(40rem,var(--kb-popper-content-available-height))] flex-col">
                <ModelSelectionList
                  navigation={nav}
                  onPick={backToCard}
                  onBack={goBack}
                />
              </div>
            }
          >
            <ModelSelectorCard onSelect={() => nav.setPage('list')} />
          </Show>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
