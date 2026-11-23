import type { TeamWithMembers } from '@service-auth/generated/schemas/teamWithMembers';
import type { UserName } from '@service-auth/generated/schemas/userName';
import type { PasswordRecipient } from '../core/types';

export function passwordRecipients(
  team: TeamWithMembers | null | undefined,
  names: UserName[],
  displayName: (id: string) => string
): PasswordRecipient[] {
  if (!team) return [];
  const people = names.flatMap((name): PasswordRecipient[] => {
    if (name.is_agent) return [];
    const member = team.members.find(
      (member) => member.user_id.toLowerCase() === name.id.toLowerCase()
    );
    if (!member) return [];
    const fullName = [name.first_name, name.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    return [
      {
        kind: 'user',
        id: member.user_id,
        name: fullName || displayName(member.user_id),
      },
    ];
  });
  return [...people, { kind: 'team', id: team.team.id, name: team.team.name }];
}
