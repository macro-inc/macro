import type { IUser } from '@core/user/types';
import { idToDisplayName, idToEmail } from '@core/user/util';
import { useContacts } from '@queries/contacts/contacts';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { MessageParent } from '@service-storage/messages';
import { type Accessor, createMemo } from 'solid-js';
import { match, P } from 'ts-pattern';
import { useChannelParticipants } from './use-channel-participants';

/**
 * The people a composer on `parent` offers in the `@`-mention typeahead: a
 * channel's participants; on a document, the workspace contacts the legacy
 * comment input suggested; on a CRM record, the team that owns it, the only
 * people who can read its discussion. Mirrors `useMessageBotMentionUsers` so
 * that every composer on a parent — root, reply, and edit — suggests the same
 * people without each one resolving them again.
 */
export function useMessageParticipants(
  parent: Accessor<MessageParent>
): Accessor<IUser[]> {
  const isChannel = () => parent().type === 'channel';
  const isCrm = () =>
    parent().type === 'crm_company' || parent().type === 'crm_contact';
  const channelParticipants = useChannelParticipants(() =>
    isChannel() ? parent().id : ''
  );
  const contacts = useContacts(() => !isChannel() && !isCrm());
  const team = useCurrentTeamQuery(isCrm);
  const teamMembers = (): IUser[] =>
    queryReadyGate(team) && team.data
      ? team.data.members.map((member) => ({
          id: member.user_id,
          email: idToEmail(member.user_id),
          name: idToDisplayName(member.user_id),
        }))
      : [];

  return createMemo(() =>
    match(parent().type)
      .with('channel', () => channelParticipants.users())
      .with('document', () => contacts())
      .with(P.union('crm_company', 'crm_contact'), () => teamMembers())
      .exhaustive()
  );
}
