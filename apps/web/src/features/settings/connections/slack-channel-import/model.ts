import {
  type ImportEntityStatus,
  type ImportRun,
  type ImportRunStatus,
  type ImportState,
  slackChannelMeta,
} from '@queries/import';
import { match } from 'ts-pattern';

export type SlackChannelRow = {
  id: string;
  channelId: string;
  name: string;
  purpose: string;
  archived: boolean;
  memberCount: number | null;
  matched: number;
  membersResolved: boolean;
  runStatus: ImportRunStatus | undefined;
  status: Exclude<ImportEntityStatus, 'discarded'>;
  entityId: string | null;
  entityType: string | null;
  importedByTeammate: boolean;
};

export function buildRows(
  state: ImportState,
  currentUserId: string | undefined
): SlackChannelRow[] {
  const run = state.runs.find((run) => run.source === 'slack');
  return state.entities.flatMap((entity) => {
    if (entity.source !== 'slack' || entity.status === 'discarded') return [];
    const meta = slackChannelMeta(entity);
    const channelId = meta?.channel_id || entity.foreign_id;
    return [
      {
        id: entity.id,
        channelId,
        name: meta?.name || channelId,
        purpose: meta?.purpose ?? '',
        archived: meta?.archived ?? false,
        memberCount: meta?.member_count ?? null,
        matched: meta?.participants?.length ?? 0,
        membersResolved: meta?.members_resolved ?? false,
        runStatus: run?.status,
        status: entity.status,
        entityId: entity.entity_id ?? null,
        entityType: entity.entity_type ?? null,
        importedByTeammate:
          entity.status === 'imported' &&
          currentUserId !== undefined &&
          entity.user_id !== currentUserId,
      },
    ];
  });
}

export function filterRows(
  rows: readonly SlackChannelRow[],
  options: { search: string; showArchived: boolean }
): SlackChannelRow[] {
  const search = options.search.trim().toLowerCase();
  return rows.filter(
    (row) =>
      (options.showArchived || !row.archived) &&
      [row.name, row.purpose, row.channelId].some((value) =>
        value.toLowerCase().includes(search)
      )
  );
}

export function selectableIds(rows: readonly SlackChannelRow[]): string[] {
  return rows.filter((row) => row.status === 'staged').map((row) => row.id);
}

export function matchLabel(row: SlackChannelRow): string {
  if (!row.membersResolved) {
    return row.runStatus === 'running'
      ? 'Checking members…'
      : 'Members not checked yet';
  }
  if (row.memberCount === null) {
    return `${row.matched} ${row.matched === 1 ? 'member' : 'members'} on your team`;
  }
  const members = row.memberCount === 1 ? 'member' : 'members';
  const verb = row.matched === 1 ? 'is' : 'are';
  return `${row.matched} of ${row.memberCount} ${members} ${verb} on your team`;
}

export function runLabel(run: ImportRun | undefined): string {
  if (!run) return 'Find public Slack channels to import.';
  return match(run.status)
    .with('running', () => 'Finding channels and checking members…')
    .with('ready', () => 'Channels ready to import')
    .with('failed', () => 'Could not find channels')
    .with('importing', () => 'Importing channels…')
    .with('completed', () => 'Import complete')
    .with('dismissed', () => 'Find public Slack channels to import.')
    .exhaustive();
}
