import { openExternalUrl } from '@core/util/url';
import { type Component, type JSXElement, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../utils/classname';
import { PillButton } from './PillButton';

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
        // At wide widths the column aligns with the chat input bar (px-2 +
        // max-w-3xl). At medium/narrow widths the bar's edge-hugging padding is
        // too tight, so we widen the padding and let the centered column keep
        // comfortable space from the split's edges (content stays left-aligned).
        'flex size-full flex-col overflow-y-auto px-10 pb-8 @4xl:px-2',
        // Centered states can span full-bleed mobile panels (e.g. the entity
        // load gate), where the panel extends behind the floating top chrome
        // — inset the content below it like other full-bleed content.
        props.centered &&
          'items-center text-center touch:pt-(--mobile-content-inset-top)',
        props.class
      )}
    >
      {/* A FIXED top spacer (not content-proportional) so the title lands on
          the same baseline for every empty state, regardless of what's below
          it. The graphic box has a fixed height too, so the title's vertical
          position is constant; the bottom grows to fill. On mobile the viewport
          is short and the wrapper already adds a top inset, so the spacer is
          reduced to keep content from overflowing the visible area. */}
      <div aria-hidden="true" class="shrink-0 basis-[28%] mobile:basis-[8%]" />
      <div
        class={cn(
          // Explicit vertical rhythm: a generous gap below the graphic, then a
          // tight title→description pairing.
          'mx-auto flex w-full shrink-0 flex-col',
          props.centered ? 'max-w-md items-center' : 'max-w-3xl items-start'
        )}
      >
        <Show when={props.graphic}>
          {(graphic) => (
            <div
              aria-hidden="true"
              class={cn(
                DEFAULT_GRAPHIC_CLASS,
                'empty-state-graphic mb-2 opacity-70',
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
          <div class="mt-3 text-sm/6 text-ink-muted">{props.description}</div>
        </Show>
        <Show when={props.primaryAction || props.documentationUrl}>
          <div
            class={cn(
              'mt-3 flex flex-wrap gap-2 @max-sm:w-full @max-sm:flex-col',
              props.centered ? 'justify-center' : 'justify-start'
            )}
          >
            <Show when={props.primaryAction}>
              {(action) => (
                <PillButton
                  tone="cta"
                  icon={action().icon}
                  onClick={action().onClick}
                >
                  {action().label}
                </PillButton>
              )}
            </Show>
            <Show when={props.documentationUrl}>
              {(url) => (
                <PillButton
                  tone="subtle"
                  onClick={() => openExternalUrl(url())}
                >
                  {props.documentationLabel ?? 'Documentation'}
                </PillButton>
              )}
            </Show>
          </div>
        </Show>
        <Show when={props.children}>
          <div
            class={cn(
              'mt-5 w-full',
              props.centered && 'flex flex-col items-center'
            )}
          >
            {props.children}
          </div>
        </Show>
      </div>
      <div aria-hidden="true" class="grow" />
    </div>
  );
}
