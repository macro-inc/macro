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
  align?: 'left' | 'center';
  children?: JSXElement;
  class?: string;
}

const DEFAULT_GRAPHIC_CLASS = 'h-48 w-48 text-ink-muted';

export function EmptyStatePanel(props: EmptyStatePanelProps) {
  const isCentered = () => props.align === 'center';

  return (
    <div
      role="status"
      class={cn(
        'flex size-full flex-col overflow-y-auto px-8 pb-8',
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
              class={cn(
                DEFAULT_GRAPHIC_CLASS,
                '-mb-8 opacity-70',
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
              'mt-2 flex flex-wrap gap-2',
              isCentered() ? 'justify-center' : 'justify-start',
              '@max-sm:w-full @max-sm:flex-col @max-sm:justify-center'
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
                  class="rounded-full px-4"
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
      <Show when={isCentered()}>
        <div class="flex-[2]" aria-hidden="true" />
      </Show>
    </div>
  );
}
