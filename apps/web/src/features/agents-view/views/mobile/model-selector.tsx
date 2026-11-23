import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import * as Popover from '@kobalte/core/popover';
import { Button } from '@ui';
import { useUnifiedModelSelector } from '../../components/unified-model-selector/root';
import { createModelSelectorNavigation } from '../../primitives/model-selector-navigation';
import { ModelSelectionList } from '../shared/model-selection-list';
import { ModelSelectorCard } from '../shared/model-selector-card';
import { UnifiedModelTriggerContent } from '../shared/model-trigger-content';

export function MobileModelSelector() {
  const state = useUnifiedModelSelector();
  const nav = createModelSelectorNavigation(state.onOpenChange);
  const sheetOpen = () => nav.open() && nav.page() !== 'card';
  let card: HTMLDivElement | undefined;
  return (
    <Popover.Root
      open={nav.open()}
      onOpenChange={(open) => {
        if (!open && sheetOpen()) return;
        nav.changeOpen(open);
      }}
      placement="top-end"
      gutter={6}
    >
      <Popover.Trigger
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
        <Popover.Content
          ref={card}
          aria-hidden={sheetOpen()}
          inert={sheetOpen()}
          class="portal-scope menu-surface z-modal w-[358px] max-w-[calc(100vw-var(--safe-left,0px)-var(--safe-right,0px)-32px)] rounded-[28px] outline-none transition-[opacity,translate] duration-200 motion-reduce:transition-none"
          style={{
            'box-shadow':
              'inset 0 0 0 1px var(--color-edge), 0 8px 24px #00000066',
            opacity: sheetOpen() ? 0.35 : 1,
            translate: sheetOpen() ? '0 12px' : '0 0',
            'pointer-events': sheetOpen() ? 'none' : 'auto',
          }}
          onInteractOutside={(event) => {
            if (sheetOpen()) event.preventDefault();
          }}
          onCloseAutoFocus={state.onCloseAutoFocus}
        >
          <Popover.Title class="sr-only">
            {t('agentControls.modelSelector')}
          </Popover.Title>
          <ModelSelectorCard mobile onSelect={() => nav.setPage('list')} />
        </Popover.Content>
      </Popover.Portal>
      <MobileDrawer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          nav.back();
        }}
        open={sheetOpen()}
        onOpenChange={(open) => {
          if (!open) nav.changeOpen(false);
        }}
        onFinalFocus={(event) => {
          event.preventDefault();
          if (nav.open())
            card?.querySelector<HTMLButtonElement>('button')?.focus();
        }}
      >
        <MobileDrawer.Portal>
          <MobileDrawer.Overlay
            style={{ 'background-color': 'rgb(0 0 0 / 0.45)' }}
          />
          <MobileDrawer.Content
            targetHeight={90}
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
