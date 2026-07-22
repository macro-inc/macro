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
  useRunImportMutation,
} from '@queries/import';
import { createMemo, For, type JSX, Match, Show, Switch } from 'solid-js';
import {
  BuilderSection,
  FailureNote,
  ItemPill,
  PillGrid,
  ProviderMeta,
  QuietAction,
  SkeletonPills,
} from './primitives';

/** Display order + connector identity per import source. */
const SOURCE_SECTIONS: {
  source: ImportSource;
  title: string;
  serverName: string;
}[] = [
  { source: 'linear', title: 'Issues', serverName: 'Linear' },
  { source: 'notion', title: 'Documents', serverName: 'Notion' },
  { source: 'slack', title: 'Channels', serverName: 'Slack' },
];

function featuredServer(name: string): FeaturedMcpServer | undefined {
  return FEATURED_MCP_SERVERS.find((server) => server.server_name === name);
}

/**
 * Split the user's staged rows into accept/decline id lists from the
 * deselection set (pills start selected). What "Continue to Macro" and the
 * per-section import actions both send to `POST /import/run`.
 */
export function stagedSelection(
  entities: ImportEntity[] | undefined,
  deselected: Record<string, boolean>,
  source?: ImportSource
): { importIds: string[]; discardIds: string[] } {
  const staged = (entities ?? []).filter(
    (entity) =>
      entity.status === 'staged' &&
      (source === undefined || entity.source === source)
  );
  return {
    importIds: staged
      .filter((entity) => !deselected[entity.id])
      .map((entity) => entity.id),
    discardIds: staged
      .filter((entity) => deselected[entity.id])
      .map((entity) => entity.id),
  };
}

/**
 * The import side of `/setup`: one section per connected source, rendered
 * from `(gather run, ledger rows)`. A running gather shimmers; staged rows
 * are selectable pills (selected by default); importing rows spin; imported
 * rows — the user's own or a teammate's team-shared — link to what they
 * became; a failed run offers a retry.
 *
 * Selection state lives in the page (SetupPage): the footer's "Continue to
 * Macro" imports the same selection the per-section actions do.
 */
export function ImportPanel(props: {
  deselected: Record<string, boolean>;
  onToggle: (id: string, deselected: boolean) => void;
}) {
  const importQuery = useImportQuery();
  const runImport = useRunImportMutation();
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

  const importSelected = (source: ImportSource) => {
    const { importIds, discardIds } = stagedSelection(
      importQuery.data?.entities,
      props.deselected,
      source
    );
    if (importIds.length === 0 && discardIds.length === 0) return;
    runImport.mutate({ importIds, discardIds });
  };

  return (
    <div class="flex flex-col gap-8 overflow-y-auto p-8">
      <header>
        <h2 class="text-lg font-semibold">Bring your work into Macro</h2>
        <p class="mt-1 text-sm text-ink-muted">
          Macro finds what's worth bringing over from each tool you connect.
          Pick what you want — everything else is left behind.
        </p>
      </header>

      <Show
        when={anyVisible()}
        fallback={
          <p class="text-sm text-ink-extra-muted">
            Connect a tool on the left to see what you can bring over.
          </p>
        }
      >
        <For each={SOURCE_SECTIONS}>
          {({ source, title, serverName }) => {
            const section = () => bySource().get(source);
            const run = () => section()?.run;
            const entities = () => section()?.entities ?? [];
            const staged = () =>
              entities().filter((entity) => entity.status === 'staged');
            const selectedCount = () =>
              staged().filter((entity) => !props.deselected[entity.id]).length;
            const server = featuredServer(serverName);
            const visible = () => run() !== undefined || entities().length > 0;

            return (
              <Show when={visible()}>
                <BuilderSection
                  title={title}
                  count={entities().length || undefined}
                  meta={
                    <ProviderMeta
                      icon={server ? <server.icon /> : undefined}
                      label={serverName}
                    />
                  }
                  actions={
                    <Show when={staged().length > 0}>
                      <QuietAction
                        label={
                          runImport.isPending
                            ? 'Importing…'
                            : `Import ${selectedCount()} selected`
                        }
                        disabled={runImport.isPending || selectedCount() === 0}
                        onClick={() => importSelected(source)}
                      />
                    </Show>
                  }
                >
                  <Switch>
                    <Match
                      when={
                        run()?.status === 'running' && entities().length === 0
                      }
                    >
                      <SkeletonPills />
                    </Match>
                    <Match
                      when={
                        run()?.status === 'failed' && entities().length === 0
                      }
                    >
                      <FailureNote
                        message="Couldn't look through this tool."
                        onRetry={() => retryGather.mutate(source)}
                      />
                    </Match>
                    <Match when={true}>
                      <PillGrid>
                        <For each={entities()}>
                          {(entity) => (
                            <ImportEntityPill
                              entity={entity}
                              icon={server ? <server.icon /> : undefined}
                              selected={!props.deselected[entity.id]}
                              onToggle={() =>
                                props.onToggle(
                                  entity.id,
                                  !props.deselected[entity.id]
                                )
                              }
                            />
                          )}
                        </For>
                      </PillGrid>
                    </Match>
                  </Switch>
                </BuilderSection>
              </Show>
            );
          }}
        </For>
      </Show>
    </div>
  );
}

/** One ledger row as a pill, styled by its status. */
function ImportEntityPill(props: {
  entity: ImportEntity;
  icon?: JSX.Element;
  selected: boolean;
  onToggle: () => void;
}) {
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
          selected={props.selected}
          onToggle={props.onToggle}
        />
      </Match>
    </Switch>
  );
}
