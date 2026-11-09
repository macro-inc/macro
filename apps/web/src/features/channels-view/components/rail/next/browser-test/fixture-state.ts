import type { ChannelEntity } from '@entity/types/entity';
import type { UserUnsubscribe } from '@service-notification/generated/schemas/userUnsubscribe';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  ChannelSectionKey,
  ChannelSectionPreferences,
} from '../../../../types';
import type { SectionDraft, SectionValue } from '../../ChannelsRailContext';

export const [channels, setChannels] = createStore<ChannelEntity[]>([
  {
    id: 'product',
    type: 'channel',
    name: 'product',
    ownerId: 'viewer',
    channelType: 'team',
    teamId: 'team',
    isParticipant: true,
  },
  {
    id: 'design',
    type: 'channel',
    name: 'design',
    ownerId: 'viewer',
    channelType: 'team',
    teamId: 'team',
    isParticipant: true,
  },
  {
    id: 'release-plan',
    type: 'channel',
    name: 'release-plan',
    ownerId: 'viewer',
    channelType: 'team',
    teamId: 'team',
    isParticipant: true,
  },
  {
    id: 'release-ops',
    type: 'channel',
    name: 'release-ops',
    ownerId: 'viewer',
    channelType: 'team',
    teamId: 'team',
    isParticipant: false,
  },
  {
    id: 'research',
    type: 'channel',
    name: 'research',
    ownerId: 'viewer',
    channelType: 'team',
    teamId: 'other-team',
    isParticipant: false,
  },
  {
    id: 'general',
    type: 'channel',
    name: 'general',
    ownerId: 'viewer',
    channelType: 'public',
    isParticipant: true,
  },
  {
    id: 'notes',
    type: 'channel',
    name: 'notes',
    ownerId: 'viewer',
    channelType: 'public',
    isParticipant: true,
  },
  {
    id: 'updates',
    type: 'channel',
    name: 'updates',
    ownerId: 'viewer',
    channelType: 'public',
    isParticipant: true,
  },
  {
    id: 'triage',
    type: 'channel',
    name: 'triage',
    ownerId: 'viewer',
    channelType: 'team',
    teamId: 'team',
    isParticipant: true,
  },
  {
    id: 'direct',
    type: 'channel',
    name: 'Example User',
    ownerId: 'viewer',
    channelType: 'direct_message',
    isParticipant: true,
    participantIds: [],
  },
]);

export const [labels, setLabels] = createStore<ChannelLabel[]>([
  {
    id: 'release',
    teamId: 'team',
    name: 'Release',
    channelIds: ['release-plan', 'release-ops'],
    explicitChannelIds: ['release-plan', 'release-ops'],
    channelCount: 2,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'support',
    name: 'Support',
    rule: { attribute: 'name', contains: 'design' },
    channelIds: ['design'],
    explicitChannelIds: [],
    channelCount: 1,
    sortOrder: 1,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'empty',
    name: 'Planning',
    channelIds: [],
    explicitChannelIds: [],
    channelCount: 0,
    sortOrder: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
]);
export const [draft, setDraft] = createSignal<SectionDraft>();
export const [muted, setMuted] = createSignal<UserUnsubscribe[]>([]);
export const [preferences, setPreferences] = createStore<
  Partial<Record<ChannelSectionKey, ChannelSectionPreferences>>
>({});
export const [collapsed, setCollapsed] = createSignal<string[]>([
  'direct_messages',
  'channels',
  'release',
]);
export const [selected, setSelected] = createSignal('product');
export const favorites = () =>
  ['design', 'product', 'general', 'notes', 'updates', 'triage'].map(
    (entityId, sortOrder) => ({
      entityId,
      entityType: 'channel' as const,
      createdAt: '2026-01-01',
      sortOrder,
    })
  );
export const changePreferences = (
  key: ChannelSectionKey,
  value: ChannelSectionPreferences
) => setPreferences(key, { ...preferences[key], ...value });
export const updateSection = async (
  label: ChannelLabel,
  name: string,
  rule = label.rule ?? undefined,
  scope?: 'personal' | 'team'
) => {
  const nextIds = new Set(label.channelIds);
  if (rule)
    for (const channel of channels)
      if (channel.name.includes(rule.contains)) nextIds.add(channel.id);
  setLabels((item) => item.id === label.id, {
    name,
    rule,
    teamId:
      scope === undefined
        ? label.teamId
        : scope === 'team'
          ? 'team'
          : undefined,
    channelIds: [...nextIds],
    channelCount: nextIds.size,
  });
};
export const saveDraft = async (value: SectionValue) => {
  const current = draft();
  if (!current) return;
  if (current.existing)
    await updateSection(current.existing, value.name, value.rule, value.scope);
  else
    setLabels([
      ...labels,
      {
        id: 'created',
        name: value.name,
        teamId: value.scope === 'team' ? 'team' : undefined,
        channelIds: current.initialChannelIds,
        explicitChannelIds: current.initialChannelIds,
        channelCount: current.initialChannelIds.length,
        sortOrder: labels.length,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ]);
  setDraft(undefined);
};
export const addChannels = async (label: ChannelLabel, ids: string[]) => {
  const channelIds = [...new Set([...label.channelIds, ...ids])];
  setLabels((item) => item.id === label.id, {
    channelIds,
    explicitChannelIds: [
      ...new Set([...(label.explicitChannelIds ?? []), ...ids]),
    ],
    channelCount: channelIds.length,
  });
  return [];
};
export const toggleCollapsed = (id: string) =>
  setCollapsed((current) =>
    current.includes(id)
      ? current.filter((value) => value !== id)
      : [...current, id]
  );
export const setMute = async (
  ids: readonly string[],
  value: boolean,
  until?: Date
) => {
  const remaining = muted().filter((item) => !ids.includes(item.item_id));
  setMuted(
    value
      ? [
          ...remaining,
          ...ids.map((item_id) => ({
            item_type: 'channel' as const,
            item_id,
            snoozed_until: until?.toISOString(),
          })),
        ]
      : remaining
  );
};
setChannels(() => true, 'latestRootMessage', {
  messageId: 'preview',
  content: 'A recent update in this conversation.',
  senderId: 'viewer',
  createdAt: '2026-11-09T14:00:00Z',
  mentions: [],
});
setChannels(
  (channel) => channel.id === 'design' || channel.id === 'release-plan',
  'unreadNotifications',
  [{ id: 'unread', state: 'unseen', createdAt: '2026-11-09T14:00:00Z' }]
);
