import ArrowLeftIcon from '@icon/system/regular/arrow-left.svg';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';
import type { AgentFaceLook } from '../core/agent-face';
import { AgentFace } from './agent-face';
import { AgentHero, AgentStage, AgentStageTitle } from './agent-stage';

/**
 * An existing agent's settings on the same stage the wizard uses: its face
 * over its color, its name in slab, then every section in one column, with
 * Save held at the bottom of the view.
 */
export function AgentEditFrame(props: {
  /** CSS color the backdrop glows in. */
  accent: string;
  hero: JSX.Element;
  title: string;
  subtitle: JSX.Element;
  busy: boolean;
  onBack: () => void;
  onSubmit: () => void;
  /** The save bar's buttons; a submit button needs `form="agent-form"`. */
  actions: JSX.Element;
  /** Where connection flows opened from a section mount their UI. */
  contentRef: (element: HTMLDivElement) => void;
  children: JSX.Element;
}) {
  return (
    <AgentStage
      label="Edit agent"
      accent={props.accent}
      header={{
        start: (
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            aria-label="Back"
            disabled={props.busy}
            onClick={props.onBack}
          >
            <ArrowLeftIcon />
          </Button>
        ),
      }}
      footer={
        <div class="sticky bottom-0 z-10 bg-gradient-to-t from-panel from-55% to-transparent px-6 pt-8 pb-4 touch:pb-[calc(var(--mobile-content-inset-bottom,0px)+1rem)]">
          <div class="mx-auto flex w-full max-w-xl items-center justify-end gap-2">
            {props.actions}
          </div>
        </div>
      }
    >
      <form
        id="agent-form"
        class="flex w-full max-w-xl flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <div class="flex flex-col items-center text-center">
          <AgentHero>{props.hero}</AgentHero>
          <AgentStageTitle>{props.title}</AgentStageTitle>
          <p class="mt-2 text-sm text-ink-muted">{props.subtitle}</p>
        </div>
        <div class="@container mt-10 flex flex-col" ref={props.contentRef}>
          {props.children}
        </div>
      </form>
    </AgentStage>
  );
}

/** One titled part of the edit page, divided from the next by a hairline. */
export function AgentEditSection(props: {
  title: string;
  description?: string;
  children: JSX.Element;
}) {
  return (
    <section class="border-t border-edge-muted py-8 first:border-t-0 first:pt-0">
      <div class="mb-4">
        <h2 class="font-[Roboto_Slab_Variable] text-xl font-[340] leading-tight tracking-[-.015em]">
          {props.title}
        </h2>
        <Show when={props.description}>
          <p class="mt-1 text-sm text-ink-muted">{props.description}</p>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

/** The agent's uploaded picture, or its face animated over the glow. */
export function AgentEditHero(props: {
  look: AgentFaceLook;
  picture?: string;
  name: string;
  thinking: boolean;
}) {
  return (
    <Show
      when={props.picture}
      fallback={
        <AgentFace
          look={props.look}
          animated
          followPointer
          state={props.thinking ? 'thinking' : 'idle'}
          class="size-28 sm:size-32"
        />
      }
    >
      {(url) => (
        <img
          src={url()}
          alt={`${props.name} avatar`}
          class="size-24 rounded-full object-cover ring ring-edge-muted"
        />
      )}
    </Show>
  );
}
