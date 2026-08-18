import { BotAvatar } from '@channel/Bots/BotAvatar';
import { LoadingSpinner } from '@core/component/LoadingSpinner';
import CaretRightIcon from '@phosphor/caret-right.svg';
import PlusIcon from '@phosphor/plus.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import type { Persona } from '@service-storage/generated/schemas/persona';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { SettingsCard, SettingsPage, SettingsSection } from '../primitives';
import { HARNESS_OPTIONS, MODEL_OPTIONS } from './personaForm';

function agentSummary(persona: Persona) {
  const harness =
    HARNESS_OPTIONS.find((option) => option.value === persona.agent.harness)
      ?.label ?? persona.agent.harness;
  const model =
    MODEL_OPTIONS.find((option) => option.value === persona.agent.model)
      ?.label ?? persona.agent.model;
  const repo = persona.agent.repo_url
    ? persona.agent.repo_url.replace(/^https:\/\/(www\.)?github\.com\//, '')
    : 'No repository';
  return `${model} · ${harness} · ${repo}`;
}

function PersonaRow(props: {
  persona: Persona;
  onOpen: (botId: string) => void;
}) {
  return (
    <button
      type="button"
      class="flex w-full items-center gap-4 px-6 py-4 text-left outline-none hover:bg-hover focus-visible:bg-hover mobile:items-start mobile:px-4"
      onClick={() => props.onOpen(props.persona.id)}
    >
      <BotAvatar bot={props.persona} size="lg" />
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-2">
          <span class="truncate text-sm font-medium text-ink">
            {props.persona.name}
          </span>
          <span class="truncate text-xs text-ink-extra-muted">
            @{props.persona.handle}
          </span>
        </div>
        <div class="mt-0.5 truncate text-xs text-ink-muted">
          {props.persona.description || agentSummary(props.persona)}
        </div>
        <Show when={props.persona.description}>
          <div class="mt-1 truncate text-xs text-ink-extra-muted">
            {agentSummary(props.persona)}
          </div>
        </Show>
      </div>
      <CaretRightIcon class="size-4 shrink-0 text-ink-extra-muted" />
    </button>
  );
}

export function PersonaList(props: {
  personas?: Persona[];
  loading: boolean;
  onCreate: () => void;
  onOpen: (botId: string) => void;
}) {
  return (
    <SettingsPage
      title="Personas"
      description="Named agents your team can mention. Each one runs with its own instructions."
      actions={
        <Button variant="cta" size="sm" onClick={props.onCreate}>
          <PlusIcon />
          New persona
        </Button>
      }
    >
      <SettingsSection
        title="Your personas"
        description="Mentioning a persona opens a sandboxed session it answers in. Anyone on your team can mention one; only admins can edit them."
      >
        <SettingsCard>
          <Show
            when={!props.loading}
            fallback={
              <div class="flex min-h-36 items-center justify-center">
                <LoadingSpinner class="size-10 p-2" />
              </div>
            }
          >
            <Show
              when={(props.personas?.length ?? 0) > 0}
              fallback={
                <div class="flex min-h-52 flex-col items-center justify-center px-8 text-center">
                  <div class="flex size-11 items-center justify-center rounded-xl bg-accent-bg text-accent">
                    <SparkleIcon class="size-6" />
                  </div>
                  <div class="mt-3 text-sm font-medium text-ink">
                    Create your first persona
                  </div>
                  <div class="mt-1 max-w-80 text-xs text-ink-muted">
                    Give it a name, a handle and instructions, and your team can
                    put it to work by mentioning it in any channel.
                  </div>
                  <Button
                    class="mt-4"
                    variant="cta"
                    size="sm"
                    onClick={props.onCreate}
                  >
                    <PlusIcon />
                    New persona
                  </Button>
                </div>
              }
            >
              <For each={props.personas}>
                {(persona) => (
                  <PersonaRow persona={persona} onOpen={props.onOpen} />
                )}
              </For>
            </Show>
          </Show>
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
