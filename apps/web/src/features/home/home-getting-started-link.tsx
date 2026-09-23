import XIcon from '@phosphor/x.svg';
import { A } from '@solidjs/router';
import { Tooltip } from '@ui';
import { Show } from 'solid-js';
import { useGettingStartedEnabled } from '../getting-started/account-gate';
import type { HomePreferences } from './home-prefs';

export function HomeGettingStartedLink(props: {
  preferences: HomePreferences;
}) {
  const enabled = useGettingStartedEnabled();

  return (
    <Show
      when={
        (import.meta.env.DEV || enabled()) &&
        !props.preferences.isDismissed('getting-started-link')
      }
    >
      <div class="mt-2 flex items-center justify-between gap-3 pl-[53.75px] pr-[7.5px] text-xs text-ink-extra-muted">
        <span>
          New to Macro? See the{' '}
          <A
            href="/component/getting-started"
            class="rounded-sm text-ink-muted underline-offset-4 transition-colors hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Getting Started
          </A>
          {' page.'}
        </span>
        <Tooltip label="Dismiss" class="shrink-0">
          <button
            type="button"
            class="flex size-[33.75px] shrink-0 items-center justify-center rounded-full transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Dismiss Getting Started link"
            onClick={() => props.preferences.dismiss('getting-started-link')}
          >
            <XIcon class="size-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </Show>
  );
}
