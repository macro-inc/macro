import { cn } from '@ui';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { PrStatusIcon } from '../component/PrStatus';
import type { PrPageReadModel } from '../context/pr-page-read-model';
import { prLifecycleStatus } from '../primitives/pr-page-state';
import { PrMergeButton } from './shared/pr-details';
import { PrChecksStatusIcon, PrStatusFade } from './shared/pr-header';
import { PrTabs } from './shared/pr-tabs';

/** Option C takes over the band tab row without remounting Tabs or hiding the top bar. */
export function PrSlimBar(props: {
  page?: PrPageReadModel;
  scrolled: boolean;
  compact: boolean;
  changesVisible: boolean;
  onChecks: (trigger: HTMLButtonElement) => void;
  stack?: JSX.Element;
}) {
  return (
    <div
      class={cn(
        'relative box-border h-12',
        props.scrolled && 'border-b border-edge-muted bg-panel'
      )}
    >
      <Show when={props.scrolled}>
        <PrStatusFade page={props.page} strip />
      </Show>
      <div class="relative mx-auto flex h-full w-full items-center gap-2 px-6 @max-[719px]/pr-page:px-4 @min-[1441px]/pr-page:max-w-[1376px]">
        <Show when={props.scrolled && props.page}>
          {(page) => (
            <div class="flex shrink-0 items-center gap-2.5">
              <span class="flex w-6 shrink-0 justify-center">
                <PrStatusIcon
                  status={prLifecycleStatus(page().pullRequest)}
                  class="size-5"
                />
              </span>
              <div class="flex items-center gap-2">
                <span class="font-mono text-xs text-ink-subtle">
                  #{page().prRef.number}
                </span>
                <PrChecksStatusIcon
                  page={page()}
                  size="strip"
                  onClick={props.onChecks}
                />
                {props.stack}
              </div>
            </div>
          )}
        </Show>
        <div
          class={cn(
            'flex min-w-0 flex-1 items-center gap-2',
            props.scrolled ? 'justify-end' : '@min-[720px]/pr-page:pl-[34px]'
          )}
        >
          <PrTabs
            size={props.scrolled ? 'sm' : 'md'}
            compact={props.scrolled && props.compact}
          />
          <Show when={!props.scrolled}>
            <span class="flex-1" />
          </Show>
          <Show when={(props.scrolled || props.changesVisible) && props.page}>
            {(page) => (
              <PrMergeButton
                page={page()}
                size={props.scrolled ? 'xs' : 'sm'}
                compact={props.scrolled && props.compact}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
