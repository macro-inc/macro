import { t } from '@app/lib/i18n';
import ArrowCounterClockwiseIcon from '@icon/system/regular/arrow-counter-clockwise.svg';
import InfoIcon from '@icon/system/regular/info.svg';
import LockIcon from '@icon/system/regular/lock-simple.svg';
import MagnifyingGlassIcon from '@icon/system/regular/magnifying-glass.svg';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import { Button } from '@ui';
import { type Component, type ComponentProps, type JSX, Show } from 'solid-js';

/**
 * Permissions cover every program the agent runs: each reaches Macro only
 * through operations the harness checks before it runs, and its TypeScript
 * module can't reach Macro at all. The agent's other tools and connected
 * apps aren't covered; the note says so plainly.
 */
export function PermissionsScopeNote(props: { agent: string }) {
  return (
    <p class="flex gap-2.5 rounded-xl border border-edge-muted px-3.5 py-2.5 text-sm leading-relaxed text-ink-muted">
      <InfoIcon
        aria-hidden="true"
        class="mt-[3px] size-4 shrink-0 text-ink-extra-muted"
      />
      <span>
        <span class="text-ink">
          {t('agentPermissions.scopeLead', { agent: props.agent })}
        </span>{' '}
        {t('agentPermissions.scopeBody', { agent: props.agent })}
      </span>
    </p>
  );
}

/** Shown instead of the Reset button to someone who can't edit the agent. */
export function PermissionsReadOnlyNote(props: { agent: string }) {
  return (
    <p class="flex items-center gap-2 px-1 text-xs text-ink-extra-muted">
      <LockIcon aria-hidden="true" class="size-3.5 shrink-0" />
      {t('agentPermissions.readOnly', { agent: props.agent })}
    </p>
  );
}

/** A centered message inside the permissions card. */
function CardMessage(props: {
  icon: Component<ComponentProps<'svg'>>;
  title: string;
  body: string;
  action?: JSX.Element;
}) {
  const Icon = props.icon;
  return (
    <div class="flex flex-col items-center gap-1 px-6 py-10 text-center">
      <Icon aria-hidden="true" class="mb-1 size-5 text-ink-extra-muted" />
      <p class="text-sm font-medium text-ink">{props.title}</p>
      <p class="text-sm text-ink-muted">{props.body}</p>
      <Show when={props.action}>
        <div class="mt-3">{props.action}</div>
      </Show>
    </div>
  );
}

export function PermissionsLoadError(props: { onRetry: () => void }) {
  return (
    <CardMessage
      icon={WarningCircleIcon}
      title={t('agentPermissions.loadFailed')}
      body={t('agentPermissions.loadFailedBody')}
      action={
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => props.onRetry()}
        >
          <ArrowCounterClockwiseIcon class="size-3.5 shrink-0 pointer-events-none" />
          {t('agentPermissions.tryAgain')}
        </Button>
      }
    />
  );
}

export function PermissionsNoMatch(props: {
  query: string;
  onClear: () => void;
}) {
  return (
    <CardMessage
      icon={MagnifyingGlassIcon}
      title={t('agentPermissions.noMatch', { query: props.query })}
      body={t('agentPermissions.noMatchBody')}
      action={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => props.onClear()}
        >
          {t('agentPermissions.clearSearch')}
        </Button>
      }
    />
  );
}
