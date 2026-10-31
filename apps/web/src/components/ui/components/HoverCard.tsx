import { HoverCard as CoreHoverCard } from '@core/component/HoverCard';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { Placement } from '@floating-ui/dom';
import { type JSX, type ParentProps, Show } from 'solid-js';
import { cn } from '../utils/classname';
import { Surface } from './Surface';

type HoverCardProps = ParentProps<{
  triggerClass?: string;
  contentClass?: string;
  placement?: Placement;
  content: JSX.Element;
  as?: 'div' | 'span' | 'button';
  triggerAriaLabel?: string;
  triggerOnClick?: JSX.EventHandler<HTMLElement, MouseEvent>;
  /**
   * When true, force the hover card closed and prevent it from opening on
   * hover. Use to defer to another surface anchored on the same trigger — e.g.
   * an editor popover that opens on click — so a click dismisses the hover card
   * instead of stacking it on top of the popover.
   */
  disabled?: boolean;
  /** Rich hover cards in the same group share one open nested branch. */
  chokeGroup?: string | false;
}>;

/**
 * Styled rich hover content that can contain controls and nested hover cards.
 * Use `Tooltip` instead when the content is only a short text hint; its
 * string-only `label` API and coordination group are intentionally separate.
 * Use `as="button"` with `triggerAriaLabel` and `triggerOnClick` for one
 * keyboard focus target; touch devices keep the button without the preview.
 *
 * @example
 * <HoverCard content={<PreviewActions />}>
 *   <button>Hover me</button>
 * </HoverCard>
 */
export function HoverCard(props: HoverCardProps) {
  return (
    <Show
      when={!isTouchDevice()}
      fallback={
        <Show when={props.as === 'button'} fallback={props.children}>
          <button
            type="button"
            aria-label={props.triggerAriaLabel}
            class={cn('inline-flex items-center', props.triggerClass)}
            onClick={props.triggerOnClick}
            disabled={props.disabled}
          >
            {props.children}
          </button>
        </Show>
      }
    >
      <CoreHoverCard
        trigger={props.children}
        content={
          <Surface
            class={cn(
              'menu-surface rounded-xl flex items-center justify-center p-2 text-ink-muted text-xs wrap-break-word',
              props.contentClass
            )}
            depth={3}
            hideBorder
          >
            {props.content}
          </Surface>
        }
        placement={props.placement ?? 'bottom'}
        overflowPadding={16}
        fitViewport={true}
        closeDelay={250}
        openDelay={250}
        flip={true}
        gutter={4}
        contentClass="max-w-[calc(100vw-32px)]"
        triggerClass={cn('inline-flex items-center', props.triggerClass)}
        triggerAs={props.as ?? 'div'}
        triggerAriaLabel={props.triggerAriaLabel}
        triggerOnClick={props.triggerOnClick}
        disabled={props.disabled}
        chokeGroup={props.chokeGroup}
      />
    </Show>
  );
}
