import { t } from '@app/lib/i18n';
import DesktopIcon from '@icon/system/regular/desktop.svg';
import LockIcon from '@icon/system/regular/lock.svg';
import PowerIcon from '@icon/system/regular/power.svg';
import { Button } from '@ui/components/Button';
import { Spinner } from '@ui/components/Spinner';
import { type Component, type JSX, Match, Show, Switch } from 'solid-js';
import type { ScreenStatus } from '../core/screen-status';

function Message(props: {
  icon?: Component<{ class?: string }>;
  busy?: boolean;
  title: string;
  hint?: string;
  children?: JSX.Element;
}) {
  return (
    <div class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/85 p-6 text-center text-ink">
      <Show when={props.busy}>
        <Spinner size="lg" decorative />
      </Show>
      <Show when={props.icon}>
        {(icon) => {
          const Icon = icon();
          return <Icon class="size-7" />;
        }}
      </Show>
      <b class="text-sm font-semibold">{props.title}</b>
      <Show when={props.hint}>
        <span class="max-w-80 text-xs text-ink-muted">{props.hint}</span>
      </Show>
      {props.children}
    </div>
  );
}

/** What covers the picture when it isn't live. Nothing while live. */
export function ScreenOverlay(props: {
  status: ScreenStatus;
  agentName: string;
  /** Present when this viewer may turn the computer on. */
  onTurnOn?: () => void;
  onRetry: () => void;
}) {
  const name = () => ({ name: props.agentName });

  return (
    <Switch>
      <Match when={props.status.kind === 'connecting'}>
        <Message
          busy
          title={t('agentScreen.connectingTitle', name())}
          hint={t('agentScreen.connectingHint')}
        />
      </Match>
      <Match when={props.status.kind === 'reconnecting'}>
        <Message
          busy
          title={t('agentScreen.reconnectingTitle')}
          hint={t('agentScreen.reconnectingHint', name())}
        />
      </Match>
      <Match when={props.status.kind === 'waking'}>
        <Message
          busy
          title={t('agentScreen.wakingTitle')}
          hint={t('agentScreen.wakingHint', name())}
        />
      </Match>
      <Match when={props.status.kind === 'asleep'}>
        <Message
          icon={PowerIcon}
          title={t('agentScreen.asleepTitle', name())}
          hint={props.onTurnOn ? t('agentScreen.asleepHint') : undefined}
        >
          <Show
            when={props.onTurnOn}
            fallback={
              <Button
                size="sm"
                variant="secondary"
                onClick={() => props.onRetry()}
              >
                {t('agentScreen.tryAgain')}
              </Button>
            }
          >
            {(turnOn) => (
              <Button size="sm" variant="primary" onClick={() => turnOn()()}>
                <PowerIcon class="size-4" />
                {t('agentScreen.turnOn')}
              </Button>
            )}
          </Show>
        </Message>
      </Match>
      <Match
        when={
          props.status.kind === 'denied' &&
          props.status.reason === 'rolloutDisabled'
        }
      >
        <Message
          icon={LockIcon}
          title={t('agentScreen.rolloutDisabledTitle')}
        />
      </Match>
      <Match when={props.status.kind === 'denied'}>
        <Message
          icon={LockIcon}
          title={t('agentScreen.deniedTitle', name())}
          hint={t('agentScreen.deniedHint')}
        />
      </Match>
      <Match when={props.status.kind === 'ended' && props.status}>
        {(ended) => (
          <Message
            icon={DesktopIcon}
            title={
              {
                stopped: t('agentScreen.endedStoppedTitle'),
                idle: t('agentScreen.endedIdleTitle'),
                accessRevoked: t('agentScreen.endedRevokedTitle'),
                notFound: t('agentScreen.endedNotFoundTitle'),
                failed: t('agentScreen.endedFailedTitle'),
              }[ended().reason]
            }
          >
            <Show
              when={
                ended().reason === 'stopped' ||
                ended().reason === 'idle' ||
                ended().reason === 'accessRevoked' ||
                ended().reason === 'failed'
              }
            >
              <Button
                size="sm"
                variant="secondary"
                onClick={() => props.onRetry()}
              >
                {ended().reason !== 'failed'
                  ? t('agentScreen.viewAgain')
                  : t('agentScreen.tryAgain')}
              </Button>
            </Show>
          </Message>
        )}
      </Match>
    </Switch>
  );
}
