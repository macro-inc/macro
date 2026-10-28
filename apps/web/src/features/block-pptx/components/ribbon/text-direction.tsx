/**
 * Text Direction (Home ▸ Paragraph and the table Layout tab): PowerPoint's
 * Horizontal, Rotate all text 90°, Rotate all text 270°, and Stacked, each
 * with its "ab" picture, and Text Options… for the Format pane.
 */

import type { TextDirection } from '@core/pptx-engine/types';
import { For, Match, Switch } from 'solid-js';
import { TEXT_DIRECTIONS } from '../../core/text-direction';
import { PopoverItem, RibbonPopover } from './controls';

const LETTERS = {
  'font-family': 'system-ui, sans-serif',
  'font-size': '7.5px',
  'font-weight': '600',
};

/** PowerPoint's picture of a direction: "ab" laid out that way, with an arrow. */
export function TextDirectionIcon(props: {
  direction: TextDirection;
  class?: string;
}) {
  const arrow = (d: string) => (
    <path
      d={d}
      fill="none"
      stroke="currentColor"
      stroke-width="1"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  );
  return (
    <svg
      viewBox="0 0 16 16"
      class={props.class ?? 'size-4'}
      aria-hidden="true"
      fill="currentColor"
    >
      <Switch>
        <Match
          when={props.direction === 'vert' || props.direction === 'eaVert'}
        >
          <text
            x="0"
            y="0"
            transform="translate(6.5 2) rotate(90)"
            {...LETTERS}
          >
            ab
          </text>
          {arrow('M12 2.5v10M10 10.5l2 2l2 -2')}
        </Match>
        <Match
          when={
            props.direction === 'vert270' || props.direction === 'mongolianVert'
          }
        >
          <text
            x="0"
            y="0"
            transform="translate(9.5 13.5) rotate(-90)"
            {...LETTERS}
          >
            ab
          </text>
          {arrow('M3.5 13.5v-10M1.5 5.5l2 -2l2 2')}
        </Match>
        <Match
          when={
            props.direction === 'wordArtVert' ||
            props.direction === 'wordArtVertRtl'
          }
        >
          <text x="3" y="7" {...LETTERS}>
            a
          </text>
          <text x="3" y="14" {...LETTERS}>
            b
          </text>
          {arrow('M11.5 2.5v10M9.5 10.5l2 2l2 -2')}
        </Match>
        <Match when={props.direction === 'horz'}>
          <text x="2.5" y="8" {...LETTERS}>
            ab
          </text>
          {arrow('M2.5 12h10M10.5 10l2 2l-2 2')}
        </Match>
      </Switch>
    </svg>
  );
}

/** The Text Direction dropdown. */
export function TextDirectionMenu(props: {
  current: TextDirection;
  disabled?: boolean;
  testId: string;
  onPick: (direction: TextDirection) => void;
  /** Text Options… (the Format pane's text box settings). */
  onMore?: () => void;
}) {
  return (
    <RibbonPopover
      label="Text Direction"
      icon={<TextDirectionIcon direction="vert" class="size-3.5" />}
      disabled={props.disabled}
      testId={props.testId}
    >
      {(close) => (
        <div class="flex w-52 flex-col">
          <For each={TEXT_DIRECTIONS}>
            {(d) => (
              <PopoverItem
                label={d.label}
                icon={<TextDirectionIcon direction={d.value} />}
                active={props.current === d.value}
                testId={`${props.testId}-${d.value}`}
                onClick={() => {
                  close();
                  props.onPick(d.value);
                }}
              />
            )}
          </For>
          <div class="my-1 border-edge-muted border-t" />
          <PopoverItem
            label="More Options…"
            testId={`${props.testId}-more`}
            onClick={() => {
              close();
              props.onMore?.();
            }}
          />
        </div>
      )}
    </RibbonPopover>
  );
}
