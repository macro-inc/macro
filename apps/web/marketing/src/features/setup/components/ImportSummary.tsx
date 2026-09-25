import GmailIcon from '@icon/mcp-gmail.svg';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { FEATURED_MCP_SERVERS } from '../core/featuredIntegrations';
import type {
  ImportEntity,
  ImportRun,
  ImportSource,
} from '../core/importPreview';
import { ContinueButton } from '../flow/shared';
import { ImportEntityPill } from '../ImportEntityPill';
import {
  FailureNote,
  ImportCard,
  PillGrid,
  SkeletonPills,
} from '../primitives';
import { SOURCE_SECTIONS, type SourceSection } from '../selection';

/** Shared recap presentation; authenticated setup supplies live data. */
export function ImportSummary(props: {
  inboxCount: number;
  emailState: 'syncing' | 'current' | 'error' | 'inactive';
  emailProgress?: { completed: number; total: number };
  contactCount: number;
  runs: ImportRun[];
  entities: ImportEntity[];
  pending?: boolean;
  error?: boolean;
  onRefresh: () => void;
  onRetryGather: (source: ImportSource) => void;
  onContinue: () => void;
}) {
  const sliceFor = (definition: SourceSection) => ({
    run: props.runs.find((run) => run.source === definition.source),
    entities: props.entities.filter(
      (entity) =>
        entity.source === definition.source && entity.status !== 'discarded'
    ),
  });

  const visibleSections = createMemo(() =>
    SOURCE_SECTIONS.filter((definition) => {
      const slice = sliceFor(definition);
      return slice.run !== undefined || slice.entities.length > 0;
    })
  );

  const anythingToShow = () =>
    props.inboxCount > 0 || visibleSections().length > 0;

  return (
    <div class="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <header class="mb-4 flex flex-col gap-4 text-center">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-3xl font-[315] leading-tight tracking-tight sm:text-[42px]"
        >
          Your workspace is taking shape.
        </h1>
        <p class="mx-auto max-w-lg text-sm leading-6 text-ink-muted">
          Review your email sync and imports. Everything keeps running in the
          background while you continue.
        </p>
      </header>
      <Show when={props.pending}>
        <p role="status" class="text-sm text-ink-muted">
          Checking import progress…
        </p>
      </Show>
      <Show when={props.error}>
        <p role="alert" class="text-sm leading-6 text-ink-muted">
          Some progress is unavailable. You can still continue.
          <button
            type="button"
            class="ml-2 underline underline-offset-4"
            onClick={props.onRefresh}
          >
            Try again
          </button>
        </p>
      </Show>
      <Show when={props.inboxCount > 0}>
        <ImportCard
          icon={<GmailIcon />}
          title="Email & contacts"
          connected
          status={
            <span class="flex flex-wrap items-center gap-1.5">
              <Show
                when={props.emailState === 'syncing' && props.emailProgress}
                fallback={
                  props.emailState === 'current'
                    ? 'email is up to date'
                    : props.emailState === 'error'
                      ? 'an inbox needs attention — review it in Email settings'
                      : props.emailState === 'inactive'
                        ? 'email sync is paused — manage it in Email settings'
                        : 'processing your inbox in the background'
                }
              >
                {(progress) => (
                  <>
                    processing your inbox —{' '}
                    {progress().completed.toLocaleString()} of{' '}
                    {progress().total.toLocaleString()} threads
                  </>
                )}
              </Show>
              <Show when={props.contactCount > 0}>
                <span>
                  · {props.contactCount.toLocaleString()} contacts found so far
                </span>
              </Show>
              <Show when={props.emailState === 'syncing'}>
                <SpinnerIcon class="size-3 shrink-0 animate-spin" />
              </Show>
            </span>
          }
        />
      </Show>

      <For each={visibleSections()}>
        {(definition) => (
          <AutoImportCard
            definition={definition}
            run={sliceFor(definition).run}
            entities={sliceFor(definition).entities}
            onRetryGather={() => props.onRetryGather(definition.source)}
          />
        )}
      </For>

      <Show when={!props.pending && !props.error && !anythingToShow()}>
        <p class="py-4 text-sm text-ink-extra-muted">
          Nothing queued — you can always ask Macro AI to bring things in later.
        </p>
      </Show>

      <div class="mt-4">
        <ContinueButton onClick={props.onContinue} />
      </div>
    </div>
  );
}

interface StatusCounts {
  staged: number;
  importing: number;
  imported: number;
}

/** One source's card: no accept toggle (auto-import owns accepting), the
 * blurb narrates gathering → importing → in your workspace. */
function AutoImportCard(props: {
  definition: SourceSection;
  run: ImportRun | undefined;
  entities: ImportEntity[];
  onRetryGather: () => void;
}) {
  const server = createMemo(() =>
    FEATURED_MCP_SERVERS.find(
      (candidate) => candidate.server_name === props.definition.serverName
    )
  );
  const serverIcon = () => {
    const found = server();
    return found ? <found.icon /> : undefined;
  };
  const counts = createMemo<StatusCounts>(() => {
    const tally: StatusCounts = { staged: 0, importing: 0, imported: 0 };
    for (const entity of props.entities) {
      if (entity.status === 'staged') tally.staged += 1;
      else if (entity.status === 'importing') tally.importing += 1;
      else if (entity.status === 'imported') tally.imported += 1;
    }
    return tally;
  });
  const gathering = () => props.run?.status === 'running';
  const importing = () =>
    props.run?.status === 'importing' || counts().importing > 0;
  const importedNoun = () =>
    counts().imported === 1
      ? props.definition.noun.replace(/s$/, '')
      : props.definition.noun;

  return (
    <ImportCard
      icon={serverIcon()}
      title={props.definition.serverName}
      count={props.entities.length || undefined}
      connected
      status={
        <Switch>
          <Match when={props.run?.status === 'failed'}>
            <FailureNote
              message={`we couldn't look through your ${props.definition.serverName}.`}
              onRetry={() => props.onRetryGather()}
            />
          </Match>
          <Match when={gathering()}>
            <span class="flex flex-wrap items-center gap-1.5">
              finding {props.definition.noun} in {props.definition.serverName}…
              <SpinnerIcon class="size-3 shrink-0 animate-spin" />
            </span>
          </Match>
          <Match when={importing()}>
            <span class="flex flex-wrap items-center gap-1.5">
              importing {props.definition.noun} into your workspace…
              <SpinnerIcon class="size-3 shrink-0 animate-spin" />
            </span>
          </Match>
          <Match when={counts().imported > 0}>
            {counts().imported} {importedNoun()} from{' '}
            {props.definition.serverName}{' '}
            {counts().imported === 1 ? 'is' : 'are'} in your workspace.
          </Match>
          <Match when={counts().staged > 0}>
            <span class="flex flex-wrap items-center gap-1.5">
              found {counts().staged} {props.definition.noun} — importing
              shortly…
              <SpinnerIcon class="size-3 shrink-0 animate-spin" />
            </span>
          </Match>
          <Match when={true}>
            nothing new to bring over from {props.definition.serverName}.
          </Match>
        </Switch>
      }
    >
      <Show when={props.entities.length > 0 || gathering()}>
        <PillGrid>
          <For each={props.entities}>
            {(entity) => (
              <ImportEntityPill entity={entity} icon={serverIcon()} />
            )}
          </For>
          <Show when={gathering()}>
            <SkeletonPills count={props.entities.length > 0 ? 3 : 6} />
          </Show>
        </PillGrid>
      </Show>
    </ImportCard>
  );
}
