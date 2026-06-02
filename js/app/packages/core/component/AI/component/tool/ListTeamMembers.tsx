import { UserIcon } from '@core/component/UserIcon';
import { tryMacroId, useDisplayName } from '@core/user';
import Envelope from '@phosphor-icons/core/regular/envelope.svg';
import Users from '@phosphor-icons/core/regular/users.svg';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import { For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer } from './ToolRenderer';

type ListTeamMembersResponse = NamedTool<'ListTeamMembers', 'response'>['data'];

type TeamMember = ListTeamMembersResponse['members'][number];
type TeamInvite = ListTeamMembersResponse['invited'][number];

const formatRole = (role: string) => role.split('_').join(' ');

function TeamMemberRow(props: { member: TeamMember }) {
  const [displayName] = useDisplayName(tryMacroId(props.member.userId));
  const name = () => displayName() || props.member.userId;

  return (
    <Tool.ListItem
      icon={<UserIcon id={props.member.userId} isDeleted={false} size="sm" />}
    >
      <div class="min-w-0 flex-1">
        <div class="truncate text-xs text-ink">{name()}</div>
        <div class="truncate text-xs capitalize text-ink-placeholder">
          {formatRole(props.member.role)}
        </div>
      </div>
    </Tool.ListItem>
  );
}

function TeamInviteRow(props: { invite: TeamInvite }) {
  return (
    <Tool.ListItem icon={<Envelope class="size-4" />}>
      <div class="min-w-0 flex-1">
        <div class="truncate text-xs text-ink">{props.invite.email}</div>
        <div class="truncate text-xs capitalize text-ink-placeholder">
          Invited as {formatRole(props.invite.role)}
        </div>
      </div>
    </Tool.ListItem>
  );
}

function TeamMembersToolResponse(props: ListTeamMembersResponse) {
  const hasMembers = () => props.members.length > 0;
  const hasInvites = () => props.invited.length > 0;

  return (
    <Tool.List>
      <Show when={hasMembers()}>
        <For each={props.members}>
          {(member) => <TeamMemberRow member={member} />}
        </For>
      </Show>
      <Show when={hasInvites()}>
        <For each={props.invited}>
          {(invite) => <TeamInviteRow invite={invite} />}
        </For>
      </Show>
      <Show when={!hasMembers() && !hasInvites()}>
        <Tool.ListItem>No team members found.</Tool.ListItem>
      </Show>
    </Tool.List>
  );
}

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

const listTeamMembersHandler = createToolRenderer({
  name: 'ListTeamMembers',
  render: (ctx) => {
    const members = () => ctx.response?.data.members ?? [];
    const invited = () => ctx.response?.data.invited ?? [];
    const statusText = () => {
      if (!ctx.response) return undefined;

      const parts = [pluralize(members().length, 'member')];
      if (invited().length > 0) {
        parts.push(pluralize(invited().length, 'pending invite'));
      }

      return parts.join(', ');
    };

    return (
      <BaseTool
        icon={Users}
        renderContext={ctx.renderContext}
        type="call"
        response={
          ctx.response ? (
            <TeamMembersToolResponse members={members()} invited={invited()} />
          ) : undefined
        }
      >
        <div class="flex min-w-0 flex-1 items-center justify-between gap-3">
          <span>Read team members</span>
          <Show when={statusText()}>
            {(text) => (
              <span class="shrink-0 text-xs text-ink-extra-muted">
                {text()}
              </span>
            )}
          </Show>
        </div>
      </BaseTool>
    );
  },
});

export { listTeamMembersHandler };
