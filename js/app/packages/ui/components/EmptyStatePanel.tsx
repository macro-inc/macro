import { type Component, For, type JSXElement, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { Button } from './Button';
import { cn } from '../utils/classname';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  hotkeyChord?: string[];
}

export interface EmptyStatePanelProps {
  graphic?: Component<{ class?: string }>;
  graphicClass?: string;
  title?: string;
  description?: JSXElement;
  primaryAction?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  align?: 'left' | 'center';
  children?: JSXElement;
  class?: string;
}

const DEFAULT_GRAPHIC_CLASS = 'h-48 w-48 text-ink-muted';

function ChordPills(props: { keys: string[] }) {
  return (
    <span class="ml-2 inline-flex items-center gap-1.5">
      <For each={props.keys}>
        {(key, i) => (
          <>
            <Show when={i() > 0}>
              <span class="text-xxs opacity-60">then</span>
            </Show>
            <span class="rounded-sm border border-current/30 bg-current/10 px-1 py-px text-xxs leading-none uppercase">
              {key}
            </span>
          </>
        )}
      </For>
    </span>
  );
}

function ActionButton(props: {
  action: EmptyStateAction;
  variant: 'cta' | 'base';
}) {
  return (
    <Button
      variant={props.variant}
      size="md"
      onClick={props.action.onClick}
    >
      {props.action.label}
      <Show when={props.action.hotkeyChord?.length}>
        <ChordPills keys={props.action.hotkeyChord!} />
      </Show>
    </Button>
  );
}

export function EmptyStatePanel(props: EmptyStatePanelProps) {
  const isCentered = () => props.align === 'center';

  return (
    <div
      role="status"
      class={cn(
        'flex size-full flex-col px-8',
        '@max-sm:px-4 @max-sm:text-center @max-sm:items-center',
        isCentered()
          ? 'items-center text-center'
          : 'items-center pt-24 @max-sm:pt-12',
        props.class
      )}
    >
      <Show when={isCentered()}>
        <div class="min-h-12 flex-1" aria-hidden="true" />
      </Show>
      <div
        class={cn(
          'flex w-full max-w-xl flex-col gap-4 @max-sm:items-center',
          isCentered() ? 'items-center' : 'items-start'
        )}
      >
        <Show when={props.graphic}>
          {(graphic) => (
            <div
              aria-hidden="true"
              class={cn(DEFAULT_GRAPHIC_CLASS, props.graphicClass)}
            >
              <Dynamic component={graphic()} class="size-full" />
            </div>
          )}
        </Show>
        <Show when={props.title}>
          <h2 class="text-base font-semibold text-ink">{props.title}</h2>
        </Show>
        <Show when={props.description}>
          <div class="text-sm/6 text-ink-muted">{props.description}</div>
        </Show>
        <Show when={props.primaryAction || props.secondaryAction}>
          <div class="mt-2 flex flex-wrap gap-2">
            <Show when={props.primaryAction}>
              {(action) => <ActionButton action={action()} variant="cta" />}
            </Show>
            <Show when={props.secondaryAction}>
              {(action) => <ActionButton action={action()} variant="base" />}
            </Show>
          </div>
        </Show>
        <Show when={props.children}>{props.children}</Show>
      </div>
      <Show when={isCentered()}>
        <div class="flex-[2]" aria-hidden="true" />
      </Show>
    </div>
  );
}
