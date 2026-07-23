import { FEATURED_MCP_SERVERS } from '@core/component/AI/constant/mcpServers';
import SpinnerIcon from '@phosphor/spinner-gap.svg';
import type { ImportEntity, ImportRun } from '@queries/import';
import { ToggleSwitch } from '@ui';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { ImportEntityPill } from './ImportEntityPill';
import { FailureNote, ImportCard, PillGrid, SkeletonPills } from './primitives';
import type { SourceSection } from './selection';

/** Row counts by status — derived once per entities change, read many times. */
interface StatusCounts {
  staged: number;
  importing: number;
  imported: number;
}

/**
 * One source's card on the import panel: connector-first header with the
 * section import toggle, a status blurb (gathering / importing / found /
 * failed-with-retry), and the pill cloud. Purely presentational over the
 * `(run, entities)` slice its parent derives — skip state and mutations
 * stay with the owners.
 */
export function SourceImportCard(props: {
  definition: SourceSection;
  run: ImportRun | undefined;
  entities: ImportEntity[];
  skipped: boolean;
  onToggleSkipped: (skipped: boolean) => void;
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
  // Skipping a section collapses its staged pills entirely;
  // importing/imported rows stay visible regardless.
  const visiblePills = createMemo(() =>
    props.skipped
      ? props.entities.filter((entity) => entity.status !== 'staged')
      : props.entities
  );

  return (
    <ImportCard
      icon={serverIcon()}
      title={props.definition.serverName}
      count={props.entities.length || undefined}
      connected
      actions={
        <Show when={counts().staged > 0}>
          <ToggleSwitch
            size="sm"
            class="flex-row-reverse"
            checked={!props.skipped}
            onChange={(checked) => props.onToggleSkipped(!checked)}
            label={props.skipped ? 'Skipped' : 'Import all'}
            labelClass="text-xs text-ink-muted select-none"
          />
        </Show>
      }
      status={
        <SectionStatus
          definition={props.definition}
          run={props.run}
          counts={counts()}
          skipped={props.skipped}
          onRetryGather={props.onRetryGather}
        />
      }
    >
      <Show when={visiblePills().length > 0 || gathering()}>
        <PillGrid>
          <For each={visiblePills()}>
            {(entity) => (
              <ImportEntityPill entity={entity} icon={serverIcon()} />
            )}
          </For>
          <Show when={gathering()}>
            <SkeletonPills count={visiblePills().length > 0 ? 3 : 6} />
          </Show>
        </PillGrid>
      </Show>
    </ImportCard>
  );
}

/**
 * The card's status blurb, continuing the well's "Connected —" lead-in
 * (lowercase starts). Failure always surfaces with a retry — even when
 * earlier/teammate imports left entities in the section, since a silent
 * failure just looks like a thin result.
 */
function SectionStatus(props: {
  definition: SourceSection;
  run: ImportRun | undefined;
  counts: StatusCounts;
  skipped: boolean;
  onRetryGather: () => void;
}) {
  return (
    <Switch>
      <Match when={props.run?.status === 'failed'}>
        <FailureNote
          message={`we couldn't look through your ${props.definition.serverName}.`}
          onRetry={() => props.onRetryGather()}
        />
      </Match>
      <Match when={props.run?.status === 'running'}>
        <span class="flex items-center gap-1.5">
          looking through your {props.definition.serverName} for{' '}
          {props.definition.noun} worth importing…
          <SpinnerIcon class="size-3 shrink-0 animate-spin" />
        </span>
      </Match>
      <Match when={props.counts.importing > 0}>
        <span class="flex items-center gap-1.5">
          importing {props.counts.importing} {props.definition.noun} into your
          workspace…
          <SpinnerIcon class="size-3 shrink-0 animate-spin" />
        </span>
      </Match>
      <Match when={props.counts.staged > 0}>
        <span>
          <Show
            when={!props.skipped}
            fallback={<>suggested imports skipped for now.</>}
          >
            here are some{' '}
            <span class="font-medium text-ink">{props.definition.noun}</span> we
            pulled in to start your workspace. You can always ask Macro AI to
            bring in more later.
          </Show>
        </span>
      </Match>
      <Match when={true}>
        {props.counts.imported} {props.definition.noun} from{' '}
        {props.definition.serverName} are in your workspace.
      </Match>
    </Switch>
  );
}
