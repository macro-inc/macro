import CreatingMark from './workspace-creating-mark.svg';
import { Match, Show, Switch } from 'solid-js';
import { MacroMarkIcon } from './macro-mark-icon';

const CREATING_PAUSE_MS = 3200;

/** How long the creating line stays up so the handoff doesn't flash past. */
function creatingPause(): number {
  if (import.meta.env.VITEST) return 0;
  if (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return 0;
  }
  return CREATING_PAUSE_MS;
}

/**
 * The beat between "create" and the desktop handoff. Creating plays the
 * mechanical Macro mark; the ready screen holds the still mark.
 */
export function WorkspaceHandoff(props: {
  phase: 'creating' | 'ready';
  accent: string;
  teamName: string;
  email: string;
  /** The address must use Google, so the team is finished on the computer. */
  connectGmailOnDesktop?: boolean;
}) {
  return (
    <div
      class="mx-auto flex w-full max-w-lg flex-col items-center py-6 text-center"
      style={{ '--intro-accent': props.accent }}
    >
      <Show
        when={props.phase === 'creating'}
        fallback={
          <div
            class="base-header-logo flex size-20 items-center justify-center rounded-[22px]"
            style={{
              color: 'var(--intro-accent)',
              background:
                'linear-gradient(145deg, color-mix(in srgb, var(--intro-accent) 7%, #171717), #090909 65%)',
              'box-shadow':
                'inset .5px .5px 1px #ffffff1c, inset -.5px -.5px 1px #0008, 0 1px 1px #131313, 0 4px 10px #0005',
            }}
          >
            <MacroMarkIcon class="h-7 w-10 overflow-visible" />
          </div>
        }
      >
        <div
          class="workspace-creating-mark mx-auto aspect-[39/45] w-full max-w-[13rem]"
          style={{ color: 'var(--intro-accent)' }}
          aria-hidden="true"
        >
          <style>{
            /*css*/ `
            @media (prefers-reduced-motion: reduce) {
              .workspace-creating-mark :is(animate, animateTransform) { display: none; }
            }
          `
          }</style>
          <CreatingMark class="block size-full" />
        </div>
      </Show>
      <Switch>
        <Match when={props.phase === 'creating'}>
          <h1
            tabindex="-1"
            class="mt-8 font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,2.25rem)] font-[315] leading-[1.15] tracking-tight outline-none"
          >
            Creating your workspace
          </h1>
          <p class="mt-4 max-w-xs text-sm leading-6 text-ink-muted">
            Setting up {props.teamName || 'your team'}.
          </p>
        </Match>
        <Match when={props.phase === 'ready'}>
          <ReadyCopy
            teamName={props.teamName}
            email={props.email}
            connectGmailOnDesktop={props.connectGmailOnDesktop}
          />
        </Match>
      </Switch>
    </div>
  );
}

function ReadyCopy(props: {
  teamName: string;
  email: string;
  connectGmailOnDesktop?: boolean;
}) {
  return (
    <div data-workspace-ready>
      <h1
        tabindex="-1"
        class="mt-8 font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,2.25rem)] font-[315] leading-[1.15] tracking-tight outline-none [text-wrap:balance]"
      >
        {props.connectGmailOnDesktop
          ? 'Finish on your computer.'
          : 'Your team has been created.'}
      </h1>
      <p class="mt-4 max-w-sm text-sm leading-6 text-ink-muted [text-wrap:balance]">
        <Show
          when={props.connectGmailOnDesktop}
          fallback={
            <>
              Finish onboarding on desktop. We emailed{' '}
              <span class="text-ink [overflow-wrap:anywhere]">
                {props.email}
              </span>{' '}
              a link to {props.teamName}. Open it there.
            </>
          }
        >
          We emailed{' '}
          <span class="text-ink [overflow-wrap:anywhere]">{props.email}</span> a
          link. Connect Gmail there to finish onboarding.
        </Show>
      </p>
    </div>
  );
}

/** Resolves after the creating line has had time to read. */
export function waitForCreatingBeat(): Promise<void> {
  const pause = creatingPause();
  if (pause === 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, pause);
  });
}
