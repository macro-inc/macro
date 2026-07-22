import {
  FEATURED_MCP_SERVERS,
  type FeaturedMcpServer,
} from '@core/component/AI/constant/mcpServers';
import { buildSimpleEntityUrl } from '@core/util/url';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import {
  entityLabel,
  type ImportEntity,
  type ImportRun,
  type ImportSource,
  useImportQuery,
  useRetryGatherMutation,
} from '@queries/import';
import { ToggleSwitch } from '@ui';
import { createMemo, For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  FailureNote,
  ImportCard,
  ItemPill,
  PillGrid,
  SkeletonPills,
} from './primitives';

/** Display order, connector identity, and item noun per import source. */
const SOURCE_SECTIONS: {
  source: ImportSource;
  serverName: string;
  /** What the items are called in blurbs ("we found 16 documents…"). */
  noun: string;
}[] = [
  { source: 'linear', serverName: 'Linear', noun: 'issues' },
  { source: 'notion', serverName: 'Notion', noun: 'documents' },
  { source: 'slack', serverName: 'Slack', noun: 'channels' },
];

function featuredServer(name: string): FeaturedMcpServer | undefined {
  return FEATURED_MCP_SERVERS.find((server) => server.server_name === name);
}

/**
 * Split the user's staged rows into accept/decline id lists from the
 * per-source skip set (sections import by default; toggling a section off
 * skips everything in it). What "Continue to Macro" sends to
 * `POST /import/run`.
 */
export function stagedSelection(
  entities: ImportEntity[] | undefined,
  skippedSources: Partial<Record<ImportSource, boolean>>
): { importIds: string[]; discardIds: string[] } {
  const staged = (entities ?? []).filter(
    (entity) => entity.status === 'staged'
  );
  return {
    importIds: staged
      .filter((entity) => !skippedSources[entity.source])
      .map((entity) => entity.id),
    discardIds: staged
      .filter((entity) => skippedSources[entity.source])
      .map((entity) => entity.id),
  };
}

/**
 * The import side of `/setup`: one card per connected source, rendered from
 * `(gather run, ledger rows)`. Each card leads with the connector and a
 * status blurb — looking through the tool (pills stream in behind shimmer
 * placeholders), what was found, importing progress, or a retry on failure.
 * Whether a section imports is a single toggle on the card; individual
 * pills are display-only. Imported rows — the user's own or a teammate's
 * team-shared — link to what they became.
 *
 * Skip state lives in the page (SetupPage): the footer's "Continue to
 * Macro" imports every section that is still toggled on.
 */
export function ImportPanel(props: {
  skipped: Partial<Record<ImportSource, boolean>>;
  onToggleSource: (source: ImportSource, skipped: boolean) => void;
}) {
  const importQuery = useImportQuery();
  const retryGather = useRetryGatherMutation();

  const bySource = createMemo(() => {
    const state = importQuery.data;
    const map = new Map<
      ImportSource,
      { run?: ImportRun; entities: ImportEntity[] }
    >();
    for (const { source } of SOURCE_SECTIONS) {
      map.set(source, {
        run: state?.runs.find((run) => run.source === source),
        entities: (state?.entities ?? []).filter(
          (entity) => entity.source === source && entity.status !== 'discarded'
        ),
      });
    }
    return map;
  });

  const anyVisible = createMemo(() =>
    SOURCE_SECTIONS.some(({ source }) => {
      const section = bySource().get(source);
      return section?.run !== undefined || (section?.entities.length ?? 0) > 0;
    })
  );

  return (
    <div class="flex flex-1 flex-col gap-7 overflow-y-auto p-8">
      <header>
        <h2 class="text-lg font-semibold">Workspace setup</h2>
      </header>

      <Show
        when={anyVisible()}
        fallback={
          <p class="text-sm text-ink-extra-muted">
            Connect a tool on the left to see what you can bring over.
          </p>
        }
      >
        <div class="flex flex-col gap-4">
          <For each={SOURCE_SECTIONS}>
            {({ source, serverName, noun }) => {
              const section = () => bySource().get(source);
              const run = () => section()?.run;
              const entities = () => section()?.entities ?? [];
              const staged = () =>
                entities().filter((entity) => entity.status === 'staged');
              const importing = () =>
                entities().filter((entity) => entity.status === 'importing');
              const imported = () =>
                entities().filter((entity) => entity.status === 'imported');
              const gathering = () => run()?.status === 'running';
              const skipped = () => props.skipped[source] === true;
              // Skipping a section collapses its staged pills entirely;
              // importing/imported rows stay visible regardless.
              const visiblePills = () =>
                skipped()
                  ? entities().filter((entity) => entity.status !== 'staged')
                  : entities();
              const server = featuredServer(serverName);
              const visible = () =>
                run() !== undefined || entities().length > 0;

              return (
                <Show when={visible()}>
                  <ImportCard
                    icon={server ? <server.icon /> : undefined}
                    title={serverName}
                    count={entities().length || undefined}
                    connected
                    actions={
                      <Show when={staged().length > 0}>
                        <ToggleSwitch
                          size="sm"
                          class="flex-row-reverse"
                          checked={!skipped()}
                          onChange={(checked) =>
                            props.onToggleSource(source, !checked)
                          }
                          label={skipped() ? 'Skipped' : 'Import all'}
                          labelClass="text-xs text-ink-muted select-none"
                        />
                      </Show>
                    }
                    status={
                      <Switch>
                        {/* A failed gather always surfaces with a retry,
                            even when earlier/teammate imports left entities
                            in the section — otherwise the failure is
                            silent and looks like a thin result. */}
                        <Match when={run()?.status === 'failed'}>
                          <FailureNote
                            message={`we couldn't look through your ${serverName}.`}
                            onRetry={() => retryGather.mutate(source)}
                          />
                        </Match>
                        <Match when={gathering()}>
                          <span class="flex items-center gap-1.5">
                            looking through your {serverName} for {noun} worth
                            importing…
                            <SpinnerIcon class="size-3 shrink-0 animate-spin" />
                          </span>
                        </Match>
                        <Match when={importing().length > 0}>
                          <span class="flex items-center gap-1.5">
                            importing {importing().length} {noun} into your
                            workspace…
                            <SpinnerIcon class="size-3 shrink-0 animate-spin" />
                          </span>
                        </Match>
                        <Match when={staged().length > 0}>
                          <span>
                            <Show
                              when={!skipped()}
                              fallback={<>suggested imports skipped for now.</>}
                            >
                              here are some{' '}
                              <span class="font-medium text-ink">{noun}</span>{' '}
                              we pulled in to start your workspace. You can
                              always ask Macro AI to bring in more later.
                            </Show>
                          </span>
                        </Match>
                        <Match when={true}>
                          {imported().length} {noun} from {serverName} are in
                          your workspace.
                        </Match>
                      </Switch>
                    }
                  >
                    <Show when={visiblePills().length > 0 || gathering()}>
                      <PillGrid>
                        <For each={visiblePills()}>
                          {(entity) => (
                            <ImportEntityPill
                              entity={entity}
                              icon={server ? <server.icon /> : undefined}
                            />
                          )}
                        </For>
                        <Show when={gathering()}>
                          <SkeletonPills
                            count={visiblePills().length > 0 ? 3 : 6}
                          />
                        </Show>
                      </PillGrid>
                    </Show>
                  </ImportCard>
                </Show>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** One ledger row as a pill, styled by its status. */
function ImportEntityPill(props: { entity: ImportEntity; icon?: JSX.Element }) {
  const code = () => {
    const identifier = props.entity.metadata.identifier;
    return typeof identifier === 'string' ? identifier : undefined;
  };
  const hoverDetail = () => {
    const meta = props.entity.metadata;
    const detail = meta.description ?? meta.summary ?? meta.purpose;
    return typeof detail === 'string' ? detail : undefined;
  };

  return (
    <Switch>
      <Match when={props.entity.status === 'imported'}>
        <ItemPill
          icon={props.icon}
          code={code()}
          label={entityLabel(props.entity)}
          importedHref={
            props.entity.entity_id && props.entity.entity_type
              ? buildSimpleEntityUrl({
                  type: props.entity.entity_type,
                  id: props.entity.entity_id,
                })
              : undefined
          }
        />
      </Match>
      <Match when={props.entity.status === 'importing'}>
        <ItemPill
          icon={props.icon}
          code={code()}
          label={entityLabel(props.entity)}
          title="Importing…"
          status={
            <SpinnerIcon class="size-3 shrink-0 animate-spin text-ink-extra-muted" />
          }
        />
      </Match>
      <Match when={true}>
        <ItemPill
          icon={props.icon}
          code={code()}
          label={entityLabel(props.entity)}
          title={hoverDetail()}
        />
      </Match>
    </Switch>
  );
}
