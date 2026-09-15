import {
  type ModelOption,
  shortlistModelOptions,
} from '@app/features/block-agent/component/compose-agent-session-options';
import { ModelPicker } from '@app/features/block-agent/component/ModelPicker';
import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import { AgentInput } from '@app/features/block-agent/ui';
import { MODEL_PRETTYNAME, Model } from '@core/component/AI/constant/model';
import { CURSOR_BOT_ID } from '@core/constant/cursorAgent';
import { MACRO_CODER_BOT_ID } from '@core/constant/macroCoder';
import { useSettingsState } from '@core/constant/SettingsState';
import { useAuthor, useUserId } from '@core/context/user';
import { useCursorModelsQuery } from '@queries/auth/cursor-api-key';
import { cn } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { AgentPill } from '../components/AgentPill';
import { type CoderCard, CoderCards } from '../components/CoderCards';
import { RepositoryPill } from '../components/RepositoryPill';
import type { AgentKind } from '../core/agent-kind';
import type { AgentsMode } from '../core/mode';
import {
  type AgentConversationEntity,
  botUsage,
} from '../core/recent-conversations';
import {
  MACRO_PERSONA_ID,
  type RosterAgent,
  rosterForMode,
} from '../core/roster';
import { createRecentRepositories } from '../primitives/recent-repositories';

/** What the composer hands the workspace to start a session with. */
export type StartConversation = {
  prompt: string;
  /** Persisted or first-party bot to run; omitted for Macro's default. */
  botId?: string;
  modelOverride?: string;
  repoUrl?: string;
};

const IN_MEMORY_MODELS: ModelOption[] = Object.values(Model).map((id) => ({
  id,
  name: MODEL_PRETTYNAME[id],
}));

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function firstName(author: string): string {
  return author.includes('@') ? author.split('@')[0] : author.split(' ')[0];
}

/**
 * The New chat / New session page: who you are talking to, and the composer
 * that starts the conversation. Chat picks the agent from a pill; Code picks
 * the coder from cards and can hand it a repository.
 */
export function NewConversationView(props: {
  mode: AgentsMode;
  roster: RosterAgent[];
  rosterLoading: boolean;
  rosterError: boolean;
  /** The loaded conversations, for each coder's usage footer. */
  conversations: AgentConversationEntity[];
  onStart: (start: StartConversation) => void;
  /** Opens the roster page on the given kind's tab. */
  onOpenRoster: (kind: AgentKind) => void;
}) {
  const userId = useUserId();
  const author = useAuthor();
  const { openSettings } = useSettingsState();
  const recentAgents = createRecentAgentSelections(userId());
  const repositories = createRecentRepositories(userId());
  const options = createMemo(() => rosterForMode(props.roster, props.mode));
  const [chatAgentId, setChatAgentId] = createSignal(MACRO_PERSONA_ID);
  const [coderId, setCoderId] = createSignal<string>();
  const [modelOverride, setModelOverride] = createSignal('');
  const [repoUrl, setRepoUrl] = createSignal<string | undefined>(
    repositories.urls()[0]
  );

  // Code leads with the coder used most recently that can still be started;
  // Macro's sandboxed coder is the fallback.
  const defaultCoderId = () =>
    recentAgents
      .ids()
      .find((id) =>
        options().some((agent) => agent.id === id && !agent.unavailableReason)
      ) ??
    options().find((agent) => !agent.unavailableReason)?.id ??
    MACRO_CODER_BOT_ID;
  const selected = createMemo(() => {
    const wanted =
      props.mode === 'code' ? (coderId() ?? defaultCoderId()) : chatAgentId();
    return options().find((agent) => agent.id === wanted) ?? options()[0];
  });
  const blocked = () => selected()?.unavailableReason;

  const pick = (id: string) => {
    if (props.mode === 'code') setCoderId(id);
    else setChatAgentId(id);
    setModelOverride('');
  };
  const connect = (id: string) => {
    if (options().find((agent) => agent.id === id)?.harness === 'cursor') {
      openSettings('Harness');
    }
  };

  const cursorConnected = () =>
    props.roster.find((agent) => agent.id === CURSOR_BOT_ID)?.runtime
      .connected ?? false;
  const cursorModels = useCursorModelsQuery(cursorConnected);
  const availableModels = (): ModelOption[] => {
    const persona = selected();
    if (!persona) return [];
    if (persona.harness === 'cursor') {
      return cursorModels.isSuccess
        ? cursorModels.data.models.map((model) => ({
            id: model.id,
            name: model.displayName,
            group: model.group ?? undefined,
          }))
        : [];
    }
    if (persona.harness === 'in-memory' || persona.harness === 'macro-inmem') {
      return IN_MEMORY_MODELS;
    }
    return [];
  };
  // The sandboxed coder picks its model once the session is up; there is no
  // catalog to choose from beforehand.
  const hasModelCatalog = () => {
    const harness = selected()?.harness;
    return (
      harness === 'cursor' ||
      harness === 'in-memory' ||
      harness === 'macro-inmem'
    );
  };

  const usage = createMemo(() => botUsage(props.conversations));
  const coderCards = (): CoderCard[] =>
    options()
      .map((agent): CoderCard => {
        const used = agent.botId ? usage().get(agent.botId) : undefined;
        return {
          id: agent.id,
          name: agent.name,
          handle: agent.handle,
          avatarUrl: agent.avatarUrl,
          cursor: agent.id === CURSOR_BOT_ID,
          system: agent.share === 'system',
          runtime: agent.runtime,
          model: agent.defaultModel,
          lastUsedAt: used?.lastUsedAt ?? 0,
          sessions: used?.sessions ?? 0,
          unavailableReason: agent.unavailableReason,
          connectLabel: agent.connectLabel,
          configurable: agent.persisted !== undefined,
        };
      })
      .toSorted((left, right) => right.lastUsedAt - left.lastUsedAt);

  const send = (markdown: string) => {
    const persona = selected();
    if (!persona || persona.unavailableReason) return;
    recentAgents.remember(persona.id);
    const repo = props.mode === 'code' ? repoUrl() : undefined;
    if (repo) repositories.remember(repo);
    props.onStart({
      prompt: markdown,
      botId: persona.botId,
      modelOverride: modelOverride() || undefined,
      repoUrl: repo,
    });
  };

  const greeting = greetingForHour(new Date().getHours());
  const placeholder = () =>
    props.mode === 'code'
      ? `Task for @${selected()?.handle ?? 'coder'} · @mention context, / for skills`
      : `Message ${selected()?.name ?? 'Macro'} · @mention anything, / for skills`;

  return (
    <div
      class={cn(
        'flex size-full flex-col items-center overflow-y-auto px-6 pb-16',
        props.mode === 'code' ? 'justify-start pt-7' : 'justify-center'
      )}
    >
      <div
        class={cn(
          'flex w-full flex-col gap-5',
          props.mode === 'code' ? 'max-w-[880px]' : 'max-w-2xl'
        )}
      >
        <Show
          when={props.mode === 'code'}
          fallback={
            <div class="text-center">
              <p class="mb-2.5 text-[15px] tracking-wide text-ink-placeholder">
                {greeting},{' '}
                <span class="capitalize">{firstName(author())}</span>
              </p>
              <h2 class="text-[28px]/tight font-medium tracking-tight text-ink text-balance">
                What should{' '}
                <span class="font-semibold">{selected()?.name ?? 'Macro'}</span>{' '}
                work on?
              </h2>
              <p class="mt-2 text-sm text-ink-subtle">
                Ask across your docs, mail, and channels. @mention anything.
              </p>
            </div>
          }
        >
          <h2 class="text-lg font-medium tracking-tight text-ink">
            What should{' '}
            <span class="font-semibold">{selected()?.name ?? 'a coder'}</span>{' '}
            work on?
          </h2>
          <CoderCards
            coders={coderCards()}
            selectedId={selected()?.id}
            loading={props.rosterLoading}
            onSelect={pick}
            onConnect={connect}
            onConfigure={() => props.onOpenRoster('coder')}
            onCreate={() => props.onOpenRoster('coder')}
          />
        </Show>

        <Show when={blocked()}>
          {(reason) => (
            <p role="status" class="px-1 text-xs text-ink-muted">
              {selected()?.name}: {reason()}
            </p>
          )}
        </Show>

        <AgentInput
          autofocus
          slashMenu="skills"
          placeholder={placeholder()}
          disabled={!!blocked()}
          onSend={send}
          modelControl={
            <div class="flex min-w-0 flex-wrap items-center gap-1.5">
              <Show when={props.mode === 'chat'}>
                <AgentPill
                  agents={options().map((agent) => ({
                    id: agent.id,
                    name: agent.name,
                    handle: agent.handle,
                    avatarUrl: agent.avatarUrl,
                    system: agent.share === 'system',
                    unavailableReason: agent.unavailableReason,
                  }))}
                  selectedId={selected()?.id ?? MACRO_PERSONA_ID}
                  onSelect={pick}
                  onCreate={() => props.onOpenRoster('agent')}
                />
              </Show>
              <Show when={hasModelCatalog()}>
                <ModelPicker
                  persona={selected()}
                  available={availableModels()}
                  shortlist={shortlistModelOptions(
                    selected(),
                    availableModels()
                  )}
                  value={modelOverride()}
                  loading={
                    selected()?.harness === 'cursor' && cursorModels.isPending
                  }
                  disabled={!!blocked()}
                  onSelect={setModelOverride}
                />
              </Show>
              <Show when={props.mode === 'code'}>
                <RepositoryPill
                  value={repoUrl()}
                  recent={repositories.urls()}
                  disabled={!!blocked()}
                  onSelect={setRepoUrl}
                  onForget={(url) => {
                    repositories.forget(url);
                    if (repoUrl() === url) setRepoUrl(undefined);
                  }}
                />
              </Show>
            </div>
          }
        />

        <Show when={props.rosterError}>
          <p role="alert" class="px-1 text-xs text-negative">
            Your saved agents could not be loaded. Macro is still available.
          </p>
        </Show>
      </div>
    </div>
  );
}
