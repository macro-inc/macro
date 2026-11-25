import { t } from '@app/lib/i18n';
import AgentMark from '@icon/system/regular/sparkle.svg';
import { Button, Card } from '@ui';
import { type ComponentProps, createSignal, type ParentProps } from 'solid-js';
import { ComposerRoot } from '../../../components/composer/parts/ComposerRoot';
import type { CalendarComposerModel } from '../../../primitives/create-calendar-composer';
import { MobileComposer } from './MobileComposer';

/** Inline review card using the same 2J fields and submit model as event creation. */
export function MobileAgentComposer(
  props: ParentProps<{
    model: CalendarComposerModel;
    onCancel: () => void;
    resolveAppLink?: ComponentProps<typeof MobileComposer>['resolveAppLink'];
  }>
) {
  const [scroll, setScroll] = createSignal<HTMLElement>();
  const [footer, setFooter] = createSignal<HTMLElement>();
  const [header, setHeader] = createSignal<HTMLElement>();
  return (
    <Card
      variant="filled"
      depth={3}
      data-calendar-tool-composer
      style={{ '--composer-title-surface': 'var(--color-surface)' }}
      class="flex min-h-0 max-h-[min(80dvh,42rem,calc(100dvh-var(--virtual-keyboard-height,0px)-var(--mobile-content-inset-top,0px)-var(--mobile-content-inset-bottom,0px)-2rem))] flex-col overflow-hidden"
    >
      <div class="flex shrink-0 items-center justify-end px-4 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={props.onCancel}
          disabled={props.model.formIsDisabled()}
        >
          {t('common.cancel')}
        </Button>
      </div>
      {props.children}
      <ComposerRoot model={props.model} class="min-h-0 flex-1">
        <div ref={setHeader} class="relative z-10 shrink-0" />
        <div ref={setScroll} class="min-h-0 flex-1 overflow-y-auto pt-2">
          <MobileComposer
            scrollElement={scroll}
            headerMount={header()}
            footerMount={footer()}
            titleIcon={<AgentMark class="size-4 text-ink-muted" />}
            resolveAppLink={props.resolveAppLink}
          />
        </div>
        <div ref={setFooter} class="shrink-0" />
      </ComposerRoot>
    </Card>
  );
}
