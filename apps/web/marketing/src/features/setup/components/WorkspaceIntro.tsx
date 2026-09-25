import { MacroMarkIcon } from '../../../app/components/graphics/MacroMarkIcon';
import { WorkspaceTexture } from './WorkspaceTexture';
import './workspace-intro.css';
import CheckIcon from '@phosphor/check.svg';
import { createUniqueId, For, type JSX, onCleanup } from 'solid-js';
import { ContinueButton } from '../flow/shared';
import {
  createWorkspaceAccent,
  WORKSPACE_ACCENTS,
} from '../primitives/workspaceAccent';

/** An onboarding-only introduction; the public homepage keeps its own hero. */
export function WorkspaceIntro(props: {
  onContinue: () => void;
  action?: JSX.Element;
}) {
  const { accent, select } = createWorkspaceAccent();
  const noiseId = createUniqueId();
  let burst!: HTMLDivElement;
  let burstAnimation: Animation | undefined;
  const celebrateAccent = () => {
    burstAnimation?.cancel();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    burstAnimation = burst.animate(
      [
        { transform: 'scale(.12)', opacity: 0 },
        { transform: 'scale(.5)', opacity: 0.24, offset: 0.2 },
        { transform: 'scale(1)', opacity: 0.1, offset: 0.6 },
        { transform: 'scale(1.2)', opacity: 0 },
      ],
      { duration: 1100, easing: 'cubic-bezier(.16,1,.3,1)' }
    );
  };
  onCleanup(() => burstAnimation?.cancel());
  const changeAccent = (color: string) => {
    if (color === accent().name) return;
    select(color);
    celebrateAccent();
  };
  return (
    <div
      data-workspace-intro
      class="isolate mx-auto flex w-full max-w-lg flex-col items-center py-2 text-center sm:py-4"
      style={{ '--intro-accent': accent().color }}
    >
      <h1
        tabindex="-1"
        class="font-[Roboto_Slab_Variable] text-[30px] font-[315] leading-[1.2] tracking-[-.025em] outline-none [text-wrap:balance] sm:text-[36px]"
      >
        Create your workspace
      </h1>
      <p class="mt-6 max-w-[460px] font-[Inter_Variable] text-sm leading-6 text-ink-muted sm:text-[15px] [text-wrap:balance]">
        Let’s make Macro feel like you, then bring in your calendar, email,
        messages and tools together.
      </p>
      <div
        class="relative mt-8 flex h-40 w-full max-w-[400px] items-center justify-center sm:h-44"
        aria-label={`${accent().name} workspace preview`}
      >
        <div
          aria-hidden="true"
          class="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[450%] w-[300%] max-w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2"
        >
          <div
            aria-hidden="true"
            class="absolute inset-0"
            style={{
              background:
                'radial-gradient(ellipse 50% 50% at center, color-mix(in srgb, var(--intro-accent) 20%, transparent) 0%, color-mix(in srgb, var(--intro-accent) 8%, transparent) 18%, color-mix(in srgb, var(--intro-accent) 2%, transparent) 32%, color-mix(in srgb, var(--intro-accent) .5%, transparent) 48%, transparent 78%)',
              filter: 'blur(12px)',
            }}
          />
          <WorkspaceTexture accent="var(--intro-accent)" filterId={noiseId} />
        </div>
        <div
          class="pointer-events-none absolute -z-10 flex size-[min(560px,80vw)] items-center justify-center"
          aria-hidden="true"
        >
          <div
            ref={burst}
            data-accent-burst
            class="size-full opacity-0"
            style={{
              background:
                'radial-gradient(circle, var(--intro-accent) 0%, color-mix(in srgb, var(--intro-accent) 60%, transparent) 20%, transparent 65%)',
              'mask-image':
                'radial-gradient(circle, black 10%, transparent 70%)',
            }}
          >
            <svg class="size-full" aria-hidden="true">
              <rect
                width="100%"
                height="100%"
                filter={`url(#${noiseId})`}
                opacity=".45"
              />
            </svg>
          </div>
        </div>
        <button
          type="button"
          aria-label="Play accent burst"
          onClick={celebrateAccent}
          class="workspace-intro-icon base-header-logo relative flex size-20 items-center justify-center rounded-[22px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink"
          style={{
            color: 'var(--intro-accent)',
            background:
              'linear-gradient(145deg, color-mix(in srgb, var(--intro-accent) 7%, #171717), #090909 65%)',
            'box-shadow':
              'inset .5px .5px 1px #ffffff1c, inset -.5px -.5px 1px #0008, 0 1px 1px #131313, 0 4px 10px #0005',
          }}
        >
          <MacroMarkIcon class="h-7 w-10 overflow-visible" />
        </button>
      </div>
      <fieldset class="mt-6 w-full max-w-[270px]">
        <legend class="mb-3 w-full text-xs text-ink-muted">
          Your accent{' '}
          <span class="text-ink-extra-muted">· {accent().name}</span>
        </legend>
        <div class="flex justify-between gap-2">
          <For each={WORKSPACE_ACCENTS}>
            {(item) => (
              <label class="relative flex size-9 items-center justify-center rounded-full has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink">
                <input
                  type="radio"
                  name="workspace-accent"
                  aria-label={item.name}
                  class="sr-only"
                  checked={accent().name === item.name}
                  onChange={() => changeAccent(item.name)}
                />
                <span
                  class="box-content flex size-6 items-center justify-center rounded-full border-solid"
                  style={{
                    background: item.color,
                    'background-clip': 'padding-box',
                    'border-width': accent().name === item.name ? '4px' : '0px',
                    'border-color': 'var(--color-ink)',
                    'box-shadow':
                      'inset 0 1px 1px #ffffff66, inset 0 -1px 1px #00000030',
                  }}
                >
                  {accent().name === item.name && (
                    <CheckIcon class="size-3.5 text-surface" />
                  )}
                </span>
              </label>
            )}
          </For>
        </div>
      </fieldset>
      <div class="mt-5">
        {props.action ?? (
          <ContinueButton label="Get started" onClick={props.onContinue} />
        )}
      </div>
    </div>
  );
}
