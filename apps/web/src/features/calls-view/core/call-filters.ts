import type { TabItem } from '@core/component/Tabs';
import type { EntityData } from '@entity';

/** A Calls tab's text label; tab items may carry rich labels elsewhere. */
export function callViewLabel(tab: TabItem): string {
  return typeof tab.label === 'string' ? tab.label : tab.value;
}

/** Client predicate ids that narrow the Calls list by who attended. */
export const CALL_AUDIENCES = [
  { id: 'call-internal', label: 'Internal' },
  { id: 'call-external', label: 'External' },
] as const;

export type CallAudienceId = (typeof CALL_AUDIENCES)[number]['id'];

const AUDIENCE_IDS = new Set<string>(CALL_AUDIENCES.map((a) => a.id));

/**
 * The next AND predicate ids after choosing an audience. Audiences are
 * exclusive, and choosing the active one clears it.
 */
export function selectCallAudience(
  andIds: readonly string[],
  id: CallAudienceId
): string[] {
  const rest = andIds.filter((active) => !AUDIENCE_IDS.has(active));
  return andIds.includes(id) ? rest : [...rest, id];
}

export type CallChannelOption = { id: string; name: string };

/**
 * Adds the channels of loaded calls to the ones already known, sorted by name.
 * Known channels stay listed after a channel filter hides their calls.
 */
export function collectCallChannels(
  known: readonly CallChannelOption[],
  entities: readonly EntityData[]
): CallChannelOption[] {
  const byId = new Map(known.map((channel) => [channel.id, channel]));
  let changed = false;
  for (const entity of entities) {
    if (entity.type !== 'call' || !entity.channelId) continue;
    const name = entity.channelName?.trim();
    const current = byId.get(entity.channelId);
    if (current && (!name || current.name === name)) continue;
    byId.set(entity.channelId, {
      id: entity.channelId,
      name: name || 'Untitled channel',
    });
    changed = true;
  }
  if (!changed) return known as CallChannelOption[];
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
