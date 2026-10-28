import { WorkspaceTexture } from '@app/components/WorkspaceTexture';
import { cn } from '@ui';
import { createUniqueId, type JSX, useContext } from 'solid-js';
import { SettingsSheetContext } from '../primitives';
import './agent-stage.css';

/**
 * The full-page frame agents are created and edited in, in the onboarding
 * style: a header row over a scrolling column, with call-to-action buttons in
 * ink. `accent` colors the glow an `AgentHero` casts.
 */
export function AgentStage(props: {
  /** Accessible name for the region. */
  label: string;
  /** CSS color the hero's backdrop glows in. */
  accent: string;
  header: { start?: JSX.Element; center?: JSX.Element; end?: JSX.Element };
  children: JSX.Element;
  /** Stays in view at the bottom of the scrolling column. */
  footer?: JSX.Element;
}) {
  const inSheet = useContext(SettingsSheetContext);
  return (
    <section
      data-agent-stage
      aria-label={props.label}
      class="relative isolate h-full min-h-0 overflow-hidden bg-panel text-ink [&_[data-variant=cta]]:bg-ink [&_[data-variant=cta]]:text-panel [&_[data-variant=cta]]:focus-visible:ring-panel/70"
      style={{ '--agent-accent': props.accent }}
    >
      <header
        class={cn(
          'absolute inset-x-0 top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 bg-gradient-to-b from-panel from-60% to-transparent px-4 pb-4',
          inSheet
            ? 'pt-2'
            : 'pt-4 touch:pt-[calc(var(--mobile-content-inset-top,0px)+0.75rem)]'
        )}
      >
        <div>{props.header.start}</div>
        <div>{props.header.center}</div>
        <div class="flex justify-end">{props.header.end}</div>
      </header>
      <div
        data-agent-stage-scroll
        data-drawer-scroll-body={inSheet ? true : undefined}
        class="flex h-full flex-col overflow-y-auto overflow-x-hidden overscroll-contain"
      >
        <div
          class={cn(
            'flex flex-1 flex-col items-center px-6',
            inSheet
              ? 'pt-14 pb-[max(24px,var(--mobile-sheet-safe-padding))]'
              : 'pt-20 pb-12 touch:pt-[calc(var(--mobile-content-inset-top,0px)+4.5rem)] touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+2rem)]'
          )}
        >
          {props.children}
        </div>
        {props.footer}
      </div>
    </section>
  );
}

/** Centers `children` in the stage's accent glow, over the onboarding grain. */
export function AgentHero(props: { children: JSX.Element }) {
  const noiseId = createUniqueId();
  return (
    <div class="relative flex items-center justify-center">
      <div
        aria-hidden="true"
        class="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[520px] w-[900px] -translate-x-1/2 -translate-y-1/2"
      >
        <div
          class="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 50% 50% at center, color-mix(in srgb, var(--agent-accent) 24%, transparent) 0%, color-mix(in srgb, var(--agent-accent) 9%, transparent) 20%, color-mix(in srgb, var(--agent-accent) 2%, transparent) 40%, transparent 72%)',
            filter: 'blur(12px)',
          }}
        />
        <WorkspaceTexture accent="var(--agent-accent)" filterId={noiseId} />
      </div>
      {props.children}
    </div>
  );
}

/** The slab headline under a hero, as in onboarding. */
export function AgentStageTitle(props: { children: JSX.Element }) {
  return (
    <h1
      tabindex="-1"
      class="mt-7 font-[Roboto_Slab_Variable] text-[28px] font-[315] leading-[1.2] tracking-[-.025em] outline-none [text-wrap:balance] sm:text-[34px]"
    >
      {props.children}
    </h1>
  );
}
