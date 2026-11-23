import { t } from '@app/lib/i18n';
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { policyIdentity } from '../core/references';
import type {
  PolicyAgent,
  PolicyKind,
  PolicyScope,
  PolicyTeam,
} from '../queries/references-view';
import { PolicyAvatar } from './policy-avatar';
import { scopeLabel } from './source-labels';

/**
 * The policy an agent follows (or will): avatar, name, @handle and whose it
 * is (Personal · Team name), with an action such as Set agent beside it.
 */
export function PolicySourceCard(props: {
  kind: PolicyKind;
  agent?: PolicyAgent | null;
  team?: PolicyTeam | null;
  scope: PolicyScope;
  /** "Use same permissions as", over the identity. */
  title?: string;
  action?: JSX.Element;
}) {
  const identity = () => policyIdentity(props);
  return (
    <div class="flex flex-col gap-2 rounded-2xl border border-edge-muted bg-panel px-4.5 py-3.5">
      <Show when={props.title}>
        <p class="text-[13px] font-medium text-ink">{props.title}</p>
      </Show>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div class="flex min-w-0 flex-1 basis-48 items-center gap-3">
          <PolicyAvatar kind={props.kind} agent={props.agent} />
          <div class="flex min-w-0 flex-col">
            <p class="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-sm">
              <span class="truncate font-medium text-ink">
                {identity().name}
              </span>
              <Show when={identity().handle}>
                {(handle) => <span class="text-accent">@{handle()}</span>}
              </Show>
            </p>
            <p class="truncate text-xs text-ink-muted">
              {scopeLabel(props.scope)}
              <Show when={props.agent?.deleted}>
                {' · '}
                {t('agentPermissions.sourceDeletedBadge')}
              </Show>
            </p>
          </div>
        </div>
        <Show when={props.action}>
          <div class="ml-auto shrink-0">{props.action}</div>
        </Show>
      </div>
    </div>
  );
}
