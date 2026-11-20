// What each caller of the participants reader shows or decides, computed from
// the reader's state. The callers are byte-identical on main and the head, so
// applying the same projection to both readers compares what users see.
// Each field cites the caller it mirrors (paths under apps/web/src).

export type Row = {
  channel_id?: string;
  user_id: string;
  role: string;
  joined_at: string;
  left_at?: string | null;
};

export type ReaderState = {
  isPending: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  data: Row[] | undefined;
};

export type ChannelType = 'public' | 'private' | 'team' | 'direct_message';

export type Contract = ReturnType<typeof project>;

/** lib/queries/gate.ts:22 `queryReadyGate`. */
function ready(state: ReaderState): state is ReaderState & { data: Row[] } {
  return !state.isPending && state.data !== undefined;
}

export function project(state: ReaderState, me: string, type: ChannelType) {
  const gated = ready(state) ? state.data : [];
  // features/channel/use-channel-participants.ts:16-24
  const ids = gated.map((row) => row.user_id);
  const others = ids.filter((id) => id !== me);
  // features/channel/Participants/ChannelParticipantsTab.tsx:45, unguarded.
  const tabRows = state.data ?? [];
  const myRole = tabRows.find((row) => row.user_id === me)?.role;
  // ChannelParticipantsTab.tsx:74-76: add and remove only in private and team channels.
  const editable = type === 'private' || type === 'team';
  const success = state.isSuccess ? (state.data ?? []) : [];
  return {
    // ShareButton.tsx:337 DmRecipientIcon, account-manager-request-button.tsx:22
    // counterparty: the first participant who isn't me.
    firstOther: others[0] ?? null,
    // ShareButton.tsx:362-385 GroupChannelLabel: the others' names in this
    // order, cut at 20 characters, "+n others"; names are a function of ids.
    groupLabelIds: others,
    // team-agent-dm-status.tsx:22-27: a DM with exactly two people.
    dmAgentCandidate:
      others[0] !== undefined && ids.length === 2 ? others[0] : null,
    // use-message-participants.ts:41 and Channel.tsx:1351: @-mention people, in order.
    mentionIds: ids,
    // components/ChannelTopIcon.tsx:49: avatars from gated data.
    topIconIds: ids,
    // SystemActivity.tsx:104-108: whether I may answer an access request.
    systemIsParticipant:
      !state.isPending && (state.data ?? []).some((row) => row.user_id === me),
    // channel-invite-button.tsx:21-25: the Invite button.
    canInvite:
      (type === 'team' || type === 'private') &&
      success.some((row) => row.user_id === me),
    // ChannelParticipantsTab.tsx:46-51: team settings and conversion.
    canManage: myRole === 'owner' || myRole === 'admin',
    // ParticipantsList.tsx:24 empty state vs list; ParticipantsListItem.tsx:16-19,66.
    tabEmpty: tabRows.length === 0,
    tabRows: tabRows.map((row) => ({
      id: row.user_id,
      role: row.role,
      removable: editable && row.user_id !== me && row.role !== 'owner',
    })),
    // ParticipantsAddPanel.tsx:20: people already in the channel are not offered.
    addPanelExcluded: [...new Set(tabRows.map((row) => row.user_id))].sort(),
    // block-channel/component/NewChannelBlockAdapter.tsx:159-160, passed as `?? []`.
    adapterParticipantIds: (state.isLoading ? [] : (state.data ?? [])).map(
      (row) => row.user_id
    ),
    // NewChannelBlockAdapter.tsx:173-177: the entity's isParticipant.
    adapterIsParticipant: state.isSuccess
      ? (state.data ?? []).some((row) => row.user_id === me)
      : null,
  };
}

/** form views/responses-view.tsx:31-37 `reach()` for the owner of a channel-shared form. */
export function formReach(value: number | null | undefined) {
  if (value === null) return 'none';
  return value === undefined ? 'unknown' : value;
}
