import { t } from '@app/lib/i18n';
import { formatTime } from '@core/util/date';
import ArrowsClockwiseIcon from '@icon/system/regular/arrows-clockwise.svg';
import { Button, Spinner } from '@ui';
import { Match, Show, Switch } from 'solid-js';
import type { RefreshState } from '../core/generation';

/**
 * Asks for a fresh run of suggestions. While one runs it says so; after one
 * was asked for it says when the next may be.
 */
export function RefreshSuggestions(props: {
  state: RefreshState;
  failed: boolean;
  onRefresh(): void;
}) {
  return (
    <div
      class="flex shrink-0 items-center gap-2"
      data-refresh={props.state.kind}
    >
      <Show when={props.failed && props.state.kind === 'ready'}>
        <span role="alert" class="text-xs text-failure">
          {t('suggestions.refreshFailed')}
        </span>
      </Show>
      <Button
        variant="ghost"
        size="sm"
        disabled={props.state.kind !== 'ready'}
        tooltip={
          props.state.kind === 'cooldown'
            ? t('suggestions.refreshCooldown')
            : undefined
        }
        onClick={props.onRefresh}
      >
        <Switch>
          <Match when={props.state.kind === 'running'}>
            <Spinner size="sm" decorative class="size-3.5" />
            {t('suggestions.refreshRunning')}
          </Match>
          <Match when={props.state.kind === 'cooldown' && props.state} keyed>
            {(cooldown) => (
              <>
                <ArrowsClockwiseIcon class="size-3.5" />
                {t('suggestions.refreshAvailableAt', {
                  time: formatTime(cooldown.availableAt),
                })}
              </>
            )}
          </Match>
          <Match when={props.state.kind === 'ready'}>
            <ArrowsClockwiseIcon class="size-3.5" />
            {t('suggestions.refresh')}
          </Match>
        </Switch>
      </Button>
    </div>
  );
}
