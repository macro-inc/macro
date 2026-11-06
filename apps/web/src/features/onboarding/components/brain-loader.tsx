import IconGmail from '@icon/gmail-color.svg';
import IconHubspot from '@icon/import/hubspot.svg';
import IconJira from '@icon/import/jira.svg';
import IconSalesforce from '@icon/import/salesforce.svg';
import IconLinear from '@icon/linear-color.svg';
import IconGithub from '@icon/mcp-github.svg';
import IconNotion from '@icon/mcp-notion.svg';
import IconSlack from '@icon/slack-color.svg';
import { For, type JSX, Show } from 'solid-js';
import './brain-loader.css';
import { MacroMarkIcon } from './macro-mark-icon';

/** Tools that wire into the brain, clockwise from the top. */
const NODES: readonly (() => JSX.Element)[] = [
  () => <IconGmail />,
  () => <IconSlack />,
  () => <IconHubspot />,
  () => <IconLinear />,
  () => <IconNotion />,
  () => <IconSalesforce />,
  () => <IconGithub />,
  () => <IconJira />,
];

/** The scene's coordinate space; nodes sit on an ellipse around the center. */
const WIDTH = 520;
const HEIGHT = 300;
const RADIUS_X = 200;
const RADIUS_Y = 112;

const nodePosition = (index: number) => {
  const angle = ((-90 + (index * 360) / NODES.length) * Math.PI) / 180;
  return {
    x: WIDTH / 2 + RADIUS_X * Math.cos(angle),
    y: HEIGHT / 2 + RADIUS_Y * Math.sin(angle),
  };
};

/**
 * Shown while the inbox is read for tools: the workspace mark, in the chosen
 * accent, assembles as tool icons wire into it. Decorative; the status line
 * carries the meaning for assistive technology.
 */
export function BrainLoader(props: { accent: string }) {
  return (
    <div
      data-brain-loader
      role="status"
      class="brain-loader mx-auto flex w-full flex-col items-center"
      style={{ '--brain-accent': props.accent }}
    >
      <div aria-hidden="true" class="brain-scene">
        <span class="brain-glow" />
        <svg
          class="brain-wires"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
        >
          <For each={NODES}>
            {(_, index) => {
              const { x, y } = nodePosition(index());
              return (
                <line
                  class="brain-wire"
                  style={{ '--i': index() }}
                  pathLength="1"
                  x1={x}
                  y1={y}
                  x2={WIDTH / 2}
                  y2={HEIGHT / 2}
                />
              );
            }}
          </For>
        </svg>
        <For each={NODES}>
          {(Icon, index) => {
            const { x, y } = nodePosition(index());
            return (
              <span
                class="brain-node"
                style={{
                  '--i': index(),
                  left: `${(x / WIDTH) * 100}%`,
                  top: `${(y / HEIGHT) * 100}%`,
                }}
              >
                <Icon />
              </span>
            );
          }}
        </For>
        <span class="brain-core">
          <MacroMarkIcon class="brain-mark h-7 w-10 overflow-visible" />
        </span>
      </div>
      <span class="sr-only">Finding the tools you use</span>
      <p
        aria-hidden="true"
        class="brain-status relative mt-2 h-6 w-full text-center text-sm text-ink-muted sm:text-[15px]"
      >
        <span class="brain-status-line" style={{ '--i': 0 }}>
          Reading your inbox…
        </span>
        <span class="brain-status-line" style={{ '--i': 1 }}>
          Finding the tools you use…
        </span>
        <span class="brain-status-line brain-status-last" style={{ '--i': 2 }}>
          Building your brain…
        </span>
      </p>
    </div>
  );
}

/**
 * Holds Continue's place while the loader runs: the seconds left before the
 * step shows the plain catalog instead.
 */
export function LoaderCountdown(props: { seconds: number }) {
  return (
    <div class="mt-6 flex shrink-0 justify-center pb-3">
      <div
        aria-hidden="true"
        class="flex min-h-14 min-w-44 items-center justify-center gap-2 rounded-full border border-edge px-7 py-3.5 text-base font-medium text-ink-muted"
      >
        <span>Loading</span>
        <Show keyed when={props.seconds}>
          {(seconds) => (
            <span class="brain-countdown-digit inline-block w-3 text-center tabular-nums text-ink">
              {seconds}
            </span>
          )}
        </Show>
      </div>
    </div>
  );
}
