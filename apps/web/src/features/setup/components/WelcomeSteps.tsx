import '@fontsource-variable/roboto-slab';
import LogoIcon from '@icon/macro-logo.svg';
import PostHogIcon from '@icon/mcp-posthog.svg';
import CalendlyIcon from '@icon/onboarding-calendly.svg';
import FigmaIcon from '@icon/onboarding-figma.svg';
import MeetIcon from '@icon/onboarding-googlemeet.svg';
import HubSpotIcon from '@icon/onboarding-hubspot.svg';
import SuperhumanIcon from '@icon/onboarding-superhuman.svg';
import ZoomIcon from '@icon/onboarding-zoom.svg';
import PlayIcon from '@phosphor/play.svg';
import { For, type JSX } from 'solid-js';
import { ContinueButton, SkipButton } from '../flow/shared';
import { MODULE_LOGOS } from '../moduleLogos';
import { StoryContinue } from './StoryContinue';

function ConstellationMark(props: { paths: readonly string[] }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <For each={props.paths}>{(path) => <path d={path} />}</For>
    </svg>
  );
}

export const CONSTELLATION_TOOLS = [
  {
    name: 'Linear',
    icon: () => <ConstellationMark paths={MODULE_LOGOS.Linear.paths} />,
    x: 50,
    y: 11,
    size: 54,
  },
  {
    name: 'Google',
    icon: () => <ConstellationMark paths={MODULE_LOGOS.Google.paths} />,
    x: 82,
    y: 39,
    size: 48,
  },
  {
    name: 'GitHub',
    icon: () => <ConstellationMark paths={MODULE_LOGOS.GitHub.paths} />,
    x: 70,
    y: 82,
    size: 44,
  },
  {
    name: 'Notion',
    icon: () => <ConstellationMark paths={MODULE_LOGOS.Notion.paths} />,
    x: 27,
    y: 80,
    size: 56,
  },
  {
    name: 'Slack',
    icon: () => <ConstellationMark paths={MODULE_LOGOS.Slack.paths} />,
    x: 15,
    y: 37,
    size: 60,
  },
  { name: 'Superhuman', icon: SuperhumanIcon, x: 92, y: 12, size: 40 },
  { name: 'Zoom', icon: ZoomIcon, x: 9, y: 72, size: 36 },
  { name: 'Google Meet', icon: MeetIcon, x: 94, y: 75, size: 30 },
  { name: 'Calendly', icon: CalendlyIcon, x: 31, y: 9, size: 32 },
  { name: 'PostHog', icon: PostHogIcon, x: 6, y: 12, size: 28 },
  { name: 'HubSpot', icon: HubSpotIcon, x: 51, y: 94, size: 26 },
  { name: 'Figma', icon: FigmaIcon, x: 77, y: 6, size: 24 },
];

/** A restrained, dimensional constellation of the tools Macro brings together. */
export function ContextScene(props: { unified?: boolean } = {}) {
  return (
    <div
      class="relative mx-auto flex h-64 w-full max-w-[calc(448px*var(--welcome-scale,1))] items-center justify-center sm:h-[calc(288px*var(--welcome-scale,1))]"
      aria-hidden="true"
      data-context-scene
    >
      <div class="absolute size-64 rounded-full border border-ink/[0.07] bg-ink/[0.02] sm:size-[calc(288px*var(--welcome-scale,1))]" />
      <div class="absolute size-[calc(176px*var(--welcome-scale,1))] rounded-full border border-ink/[0.12] bg-ink/[0.03]" />
      <svg
        viewBox="-224 -144 448 288"
        class="pointer-events-none absolute inset-0 size-full overflow-visible text-ink"
        fill="none"
      >
        <For each={Array.from({ length: 54 }, (_, index) => index)}>
          {(index) => (
            <circle
              r={56 + index * 8}
              stroke="currentColor"
              stroke-width="0.75"
              opacity={0.1 * (1 - index / 54) ** 2.6}
            />
          )}
        </For>
      </svg>
      <div class="ob-welcome-logo glass relative z-10 flex size-[calc(96px*var(--welcome-scale,1))] items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-surface),var(--color-ink)_12%)]">
        <LogoIcon class="size-1/2 text-ink" />
      </div>
      <For each={CONSTELLATION_TOOLS}>
        {(planet, index) => (
          <div
            title={planet.name}
            data-constellation-tool={planet.name}
            class="ob-orbit-tile glass absolute flex items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-surface),var(--color-ink)_8%)] text-ink [&_svg]:size-[44%]"
            style={{
              position: 'absolute',
              left: `${props.unified ? 50 + Math.cos((index() * Math.PI) / 6) * 28 : planet.x}%`,
              top: `${props.unified ? 50 + Math.sin((index() * Math.PI) / 6) * 43 : planet.y}%`,
              width: `calc(${props.unified ? 28 : planet.size}px * var(--welcome-scale, 1))`,
              height: `calc(${props.unified ? 28 : planet.size}px * var(--welcome-scale, 1))`,
              opacity: props.unified ? 0.55 : 1,
              'animation-delay': `${index() * 55}ms`,
            }}
          >
            <span
              class="flex size-full items-center justify-center"
              style={{ opacity: planet.size < 36 ? 0.6 : 1 }}
            >
              <planet.icon />
            </span>
          </div>
        )}
      </For>
    </div>
  );
}

export function WelcomeStep(props: {
  onContinue: () => void;
  action?: JSX.Element;
}) {
  return (
    <div class="ob-welcome relative isolate flex flex-col items-center gap-7 overflow-x-clip [overflow-clip-margin:200px] text-center md:[--welcome-scale:1.25] md:gap-[35px] md:[overflow-clip-margin:250px]">
      <ContextScene />
      <div class="relative mt-[15px] flex flex-col gap-4 md:mt-[18.75px] md:gap-5">
        <h1
          tabindex="-1"
          data-welcome-heading
          class="font-[Roboto_Slab_Variable] font-[315] text-4xl leading-[1.12] tracking-tight sm:text-5xl md:text-[60px]"
        >
          One unified interface
          <br />
          for all your work.
        </h1>
        <p
          data-welcome-copy
          class="mx-auto max-w-sm text-sm leading-6 text-ink-muted md:max-w-[480px] md:text-[17.5px] md:leading-[30px]"
        >
          Work together with your agents, with every conversation, document, and
          tool in one place.
        </p>
      </div>
      <div
        data-welcome-copy
        class="flex w-full justify-center md:[&>div]:mt-[50px] md:[&>div]:pb-[25px] md:[&_button]:gap-2.5 md:[&_button]:px-[25px] md:[&_button]:py-[15px] md:[&_button]:text-[15px] md:[&_svg]:size-5"
      >
        {props.action ?? (
          <StoryContinue label="Get started" onClick={props.onContinue} />
        )}
      </div>
    </div>
  );
}

export function IntroductionStep(props: {
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <div class="flex flex-col gap-5">
      <div class="relative flex aspect-video flex-col items-center justify-center gap-4 overflow-hidden rounded-3xl border border-ink/10 bg-ink/[0.03] shadow-[inset_0_1px_0_var(--color-edge)]">
        <div class="flex size-16 items-center justify-center rounded-full border border-ink/10 bg-surface shadow-lg">
          <PlayIcon class="size-6 text-ink-muted" />
        </div>
        <div class="text-center">
          <p class="text-sm font-medium">Meet your new workspace</p>
          <p class="mt-1 text-xs text-ink-muted">
            A short film with the founders · Coming soon
          </p>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-4 text-center text-xs leading-5 text-ink-muted">
        <span>
          Bring your tools
          <br />
          <strong class="font-medium text-ink">into one place</strong>
        </span>
        <span>
          Find the context
          <br />
          <strong class="font-medium text-ink">behind your work</strong>
        </span>
        <span>
          Move forward
          <br />
          <strong class="font-medium text-ink">with your team</strong>
        </span>
      </div>
      <ContinueButton label="Set up my workspace" onClick={props.onContinue} />
      <SkipButton onClick={props.onSkip} />
    </div>
  );
}
