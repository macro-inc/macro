import { t } from '@app/lib/i18n';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import type { ToolPermissionSource } from '@service-agent-harness/generated/schemas';
import { type JSX, Match, Show, Switch } from 'solid-js';
import { policyIdentity } from '../core/references';
import { PolicySourceCard } from './policy-source-card';
import { policyName } from './source-labels';

/** "@macro", or the name (a deleted agent, a team's default), for prose. */
export function sourceMention(source: {
  agent?: ToolPermissionSource['agent'];
  kind?: string | null;
}) {
  const handle = policyIdentity(source).handle;
  return handle ? `@${handle}` : policyName(source);
}

/**
 * What an agent follows: the source's card (with `action`, such as Set
 * agent), that it follows changes made there, the rest of the chain, and
 * what to do when the source was deleted, is gone, or is out of scope.
 */
export function FollowingNote(props: {
  source: ToolPermissionSource;
  title?: string;
  action?: JSX.Element;
}) {
  const mention = () => sourceMention(props.source);
  const via = () =>
    props.source.via
      .map((entry) => (entry.handle ? `@${entry.handle}` : entry.name))
      .join(', ');

  return (
    <div class="flex flex-col gap-2">
      <Show when={props.source.status !== 'lost'}>
        <PolicySourceCard
          kind={props.source.kind}
          agent={props.source.agent}
          scope={props.source.scope}
          title={props.title}
          action={props.action}
        />
      </Show>
      <Switch
        fallback={
          <p class="px-1 text-sm text-ink-muted">
            {t('agentPermissions.followsChanges', { source: mention() })}
            <Show when={props.source.via.length > 0}>
              {' '}
              {t('agentPermissions.followsVia', {
                source: mention(),
                via: via(),
              })}
            </Show>
          </p>
        }
      >
        <Match when={props.source.status === 'lost'}>
          <Warning action={props.action}>
            {t('agentPermissions.sourceLost')}
          </Warning>
        </Match>
        <Match when={props.source.status === 'deleted'}>
          <Warning>
            {t('agentPermissions.sourceDeleted', { source: mention() })}
          </Warning>
        </Match>
        <Match when={!props.source.inScope}>
          <Warning>
            {t('agentPermissions.sourceOutOfScope', { source: mention() })}
          </Warning>
        </Match>
      </Switch>
    </div>
  );
}

function Warning(props: { children: JSX.Element; action?: JSX.Element }) {
  return (
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-edge-muted px-3.5 py-2.5 text-sm text-ink">
      <WarningCircleIcon
        aria-hidden="true"
        class="size-4 shrink-0 text-failure"
      />
      <span role="status" class="min-w-0 flex-1 basis-56">
        {props.children}
      </span>
      <Show when={props.action}>
        <span class="ml-auto shrink-0">{props.action}</span>
      </Show>
    </div>
  );
}
