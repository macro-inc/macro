import { openExternalUrl } from '@core/util/url';
import { type Component, type JSXElement, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { Button } from './Button';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  /** Optional leading icon, e.g. a plus for "create" actions. */
  icon?: Component<{ class?: string }>;
}

export interface EmptyStatePanelProps {
  graphic?: Component<{ class?: string }>;
  graphicClass?: string;
  title?: string;
  description?: JSXElement;
  primaryAction?: EmptyStateAction;
  /**
   * When set, renders a secondary "Documentation" button that opens the given
   * URL in a new tab. Omit when no relevant documentation page exists.
   */
  documentationUrl?: string;
  documentationLabel?: string;
  /**
   * Centered, vertically-balanced variant for very simple states (e.g. "no
   * results") that are just a graphic and a line of text. Defaults to the
   * left-aligned column that stacks with the chat input.
   */
  centered?: boolean;
  children?: JSXElement;
  class?: string;
}

const DEFAULT_GRAPHIC_CLASS = 'h-48 w-48 text-ink-muted';

export function EmptyStatePanel(props: EmptyStatePanelProps) {
  return (
    <div
      role="status"
      class={cn(
        'flex size-full flex-col overflow-y-auto px-2 pb-8',
        // Default: left-aligned column sized to the chat input (px-2 + max-w-3xl)
        // so the empty state stacks into one column with the input at the bottom
        // of the block. Centered: a simple, vertically-balanced graphic + text.
        props.centered
          ? 'items-center justify-center pt-8 text-center'
          : 'pt-24 @max-sm:pt-12',
        props.class
      )}
    >
      <div
        class={cn(
          'mx-auto flex w-full flex-col gap-4',
          props.centered ? 'max-w-md items-center' : 'max-w-3xl items-start'
        )}
      >
        <Show when={props.graphic}>
          {(graphic) => (
            <div
              aria-hidden="true"
              class={cn(
                DEFAULT_GRAPHIC_CLASS,
                'empty-state-graphic -mb-8 opacity-70',
                props.graphicClass
              )}
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
        <Show when={props.primaryAction || props.documentationUrl}>
          <div
            class={cn(
              'mt-2 flex flex-wrap gap-2 @max-sm:w-full @max-sm:flex-col',
              props.centered ? 'justify-center' : 'justify-start'
            )}
          >
            <Show when={props.primaryAction}>
              {(action) => (
                <Button
                  variant="cta"
                  size="md"
                  class={cn(
                    'rounded-full',
                    action().icon ? 'pl-3 pr-4' : 'px-4'
                  )}
                  onClick={action().onClick}
                >
                  <Show when={action().icon}>
                    {(icon) => <Dynamic component={icon()} class="size-4" />}
                  </Show>
                  {action().label}
                </Button>
              )}
            </Show>
            <Show when={props.documentationUrl}>
              {(url) => (
                <Button
                  variant="base"
                  size="md"
                  class="rounded-full border-edge bg-ink/5 px-4"
                  onClick={() => openExternalUrl(url())}
                >
                  {props.documentationLabel ?? 'Documentation'}
                </Button>
              )}
            </Show>
          </div>
        </Show>
        <Show when={props.children}>{props.children}</Show>
      </div>
    </div>
  );
}
