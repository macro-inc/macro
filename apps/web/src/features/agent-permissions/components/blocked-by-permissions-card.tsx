import { t } from '@app/lib/i18n';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import ProhibitIcon from '@icon/system/regular/prohibit.svg';
import type { GatedOperation } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { GatedOperationList } from './gated-operation-list';
import { describeGatedThings } from './gated-phrases';

/**
 * A program the agent's permissions refused before it ran, because it could
 * call operations set to Never: what it could have done, and where to change
 * that. Shaped like the chat's failure notices, in failure ink, so it reads
 * as the agent's action failing rather than as an ordinary broken step.
 */
export function BlockedByPermissionsCard(props: {
  agentName: string;
  operations: readonly GatedOperation[];
  /** The viewer may edit the agent, so the card links to its permissions. */
  canEdit: boolean;
  onReview?: () => void;
}) {
  return (
    <section
      aria-label={t('agentPermissionsChat.blockedTitle')}
      class="@container/card min-w-0 overflow-hidden rounded-xl border border-edge-muted bg-panel text-ink"
    >
      <div class="flex items-start gap-3 px-4 pt-4">
        <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-failure-bg text-failure">
          <ProhibitIcon aria-hidden="true" class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">
            {t('agentPermissionsChat.blockedTitle')}
          </div>
          <p class="mt-0.5 text-sm leading-5 text-ink-muted [overflow-wrap:anywhere]">
            {t('agentPermissionsChat.blockedBody', {
              things: describeGatedThings(props.operations),
              agent: props.agentName,
            })}
          </p>
          <GatedOperationList operations={props.operations} />
        </div>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 py-3 pr-3 pl-4 @min-[420px]/card:pl-15">
        <Show
          when={props.canEdit}
          fallback={
            <p class="flex items-center gap-1.5 text-xs leading-4 text-ink-extra-muted">
              <LockIcon aria-hidden="true" class="size-3.5 shrink-0" />
              {t('agentPermissionsChat.blockedReadOnly', {
                agent: props.agentName,
              })}
            </p>
          }
        >
          <p class="text-xs leading-4 text-ink-extra-muted">
            {t('agentPermissionsChat.blockedTold', { agent: props.agentName })}
          </p>
          <Show when={props.onReview}>
            {(onReview) => (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                class="gap-1.5"
                onClick={() => onReview()()}
              >
                {t('agentPermissionsChat.reviewPermissions')}
                <ArrowSquareOutIcon
                  aria-hidden="true"
                  class="size-3.5 shrink-0 pointer-events-none"
                />
              </Button>
            )}
          </Show>
        </Show>
      </div>
    </section>
  );
}
