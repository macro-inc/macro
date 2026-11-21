import { t } from '@app/lib/i18n';
import { AgentTag } from '@core/component/AgentTag';
import { UserIcon } from '@core/component/UserIcon';
import { type JSX, Show } from 'solid-js';

/**
 * Text that may be an email address, which a narrow row wraps before its
 * `@` rather than anywhere in the domain.
 */
function AddressBreak(props: { text: string }) {
  const at = () => props.text.indexOf('@');
  return (
    <Show when={at() > 0} fallback={props.text}>
      {props.text.slice(0, at())}
      <wbr />
      {props.text.slice(at())}
    </Show>
  );
}

/**
 * A person in Team › Members, laid out like a Machines row: their picture,
 * name and email, one muted line with their role and seat plan, and a ⋯ that
 * holds what the viewer can change. Every width shows the same row; on
 * narrow rows the text wraps rather than cut a name or email short.
 */
export function TeamMemberRow(props: {
  userId: string;
  name: string;
  /** Left out when the name is the email. */
  email?: string;
  isCurrentUser: boolean;
  isAgent: boolean;
  summary: string;
  menu?: JSX.Element;
}) {
  return (
    <div
      data-team-member={props.userId}
      class="flex items-center gap-3 px-4 py-4"
    >
      <div class="shrink-0">
        <UserIcon id={props.userId} isDeleted={false} size="lg" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex min-w-0 items-center gap-1.5">
          <div
            data-member-name
            class="truncate text-sm font-medium text-ink @max-[480px]:whitespace-normal @max-[480px]:break-words"
          >
            <AddressBreak text={props.name} />
            {props.isCurrentUser && (
              <span class="font-normal text-ink-muted">
                {' '}
                {t('teamMembers.you')}
              </span>
            )}
          </div>
          <Show when={props.isAgent}>
            <AgentTag />
          </Show>
        </div>
        <Show when={props.email}>
          <div
            data-member-email
            class="truncate text-xs text-ink-muted @max-[480px]:whitespace-normal @max-[480px]:break-words"
          >
            <AddressBreak text={props.email ?? ''} />
          </div>
        </Show>
        <div data-member-summary class="text-xs text-ink-muted">
          {props.summary}
        </div>
      </div>
      {props.menu}
    </div>
  );
}
