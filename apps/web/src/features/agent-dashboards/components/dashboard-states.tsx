import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import LockIcon from '@icon/system/regular/lock.svg';
import SquaresFourIcon from '@icon/system/regular/squares-four.svg';
import { Button } from '@ui';
import { For, type JSX } from 'solid-js';

function Message(props: {
  icon: JSX.Element;
  title: string;
  body: string;
  action?: JSX.Element;
}) {
  return (
    <div class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
      {props.icon}
      <h2 class="text-sm font-semibold text-ink">{props.title}</h2>
      <p class="max-w-sm text-sm text-ink-muted">{props.body}</p>
      {props.action}
    </div>
  );
}

/** No dashboard here yet: an agent sets one up through the SDK. */
export function DashboardEmpty() {
  return (
    <Message
      icon={<SquaresFourIcon class="size-5 text-ink-extra-muted" />}
      title={t('agentDashboards.emptyTitle')}
      body={t('agentDashboards.emptyBody')}
    />
  );
}

export function DashboardNoAccess() {
  return (
    <Message
      icon={<LockIcon class="size-5 text-ink-extra-muted" />}
      title={t('agentDashboards.noAccessTitle')}
      body={t('agentDashboards.noAccessBody')}
    />
  );
}

export function DashboardError(props: { onRetry: () => void }) {
  return (
    <Message
      icon={<SquaresFourIcon class="size-5 text-ink-extra-muted" />}
      title={t('agentDashboards.errorTitle')}
      body={t('agentDashboards.errorBody')}
      action={
        <Button variant="secondary" size="sm" onClick={() => props.onRetry()}>
          {t('agentDashboards.retry')}
        </Button>
      }
    />
  );
}

/** Pane-shaped placeholders while the dashboard itself loads. */
export function DashboardLoading() {
  return (
    <ListSkeleton.Root
      label={t('agentDashboards.loading')}
      class="flex flex-col gap-3"
    >
      <For each={[0, 1, 2]}>
        {() => (
          <div class="flex flex-col gap-2 rounded-lg border border-edge-muted p-3">
            <ListSkeleton.Bar class="w-32" />
            <ListSkeleton.Bar class="w-full" />
            <ListSkeleton.Bar class="w-2/3" />
          </div>
        )}
      </For>
    </ListSkeleton.Root>
  );
}

/** A pane still loading its own data. */
export function PaneLoading() {
  return (
    <div class="flex flex-col gap-2 rounded-lg border border-edge-muted p-3">
      <ListSkeleton.Bar class="w-24" />
      <ListSkeleton.Bar class="w-full" />
    </div>
  );
}
