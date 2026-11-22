import { t } from '@app/lib/i18n';
import { linkGithubAccount } from '@core/auth/authorize-github';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { fireAndForget } from '@core/util/fireAndForget';
import { isDesktopPlatform } from '@core/util/platform';
import {
  readGithubLinkStatus,
  useGithubLinkStatusQuery,
} from '@queries/auth/github-link';
import { useNavigate } from '@solidjs/router';
import { Button } from '@ui';
import { ResultAsync } from 'neverthrow';
import {
  createEffect,
  createSignal,
  Match,
  on,
  onMount,
  Switch,
} from 'solid-js';

/** Set while a web page has left for GitHub, so its return never loops. */
const STARTED_KEY = 'github-connect-started';

const INTEGRATIONS_PATH = '/settings/connections';

type Phase = 'starting' | 'in-browser' | 'failed';

function markStarted(started: boolean) {
  try {
    if (started) sessionStorage.setItem(STARTED_KEY, '1');
    else sessionStorage.removeItem(STARTED_KEY);
  } catch {
    // Storage blocked: a declined consent then shows the retry at once.
  }
}

function wasStarted(): boolean {
  try {
    return sessionStorage.getItem(STARTED_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Where GitHub's connect step lands (`/app/connect/github`): GitHub's
 * connection is the Macro GitHub account link, which only the app can start.
 * The page starts it, and once the account is linked returns to Settings →
 * Integrations. On the web the page leaves for GitHub and comes back here; a
 * return without a link (the user declined) offers a retry rather than
 * starting again. The desktop app finishes in the system browser.
 */
export function GithubConnectPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = createSignal<Phase>('starting');
  const link = useGithubLinkStatusQuery({
    enabled: () => phase() !== 'starting',
  });
  const backToSettings = () => navigate(INTEGRATIONS_PATH, { replace: true });

  // The desktop app learns of the link from its deep-link return, which
  // refreshes the link status.
  createEffect(
    on(
      () => (link.isSuccess ? link.data.status : undefined),
      (status) => {
        if (phase() === 'in-browser' && status === 'linked') backToSettings();
      }
    )
  );

  async function start() {
    setPhase('starting');
    markStarted(true);
    const linked = await ResultAsync.fromPromise(
      linkGithubAccount(t('githubConnect.failed')),
      () => ({ kind: 'link-start-failed' as const })
    );
    if (linked.isOk() && linked.value) {
      markStarted(false);
      backToSettings();
      return;
    }
    if (linked.isOk() && isDesktopPlatform()) {
      setPhase('in-browser');
      return;
    }
    // The web page is on its way to GitHub; anything else did not link.
    if (linked.isOk() && !isNativeMobilePlatform()) return;
    markStarted(false);
    setPhase('failed');
  }

  async function begin() {
    const status = await ResultAsync.fromPromise(
      readGithubLinkStatus(),
      () => ({
        kind: 'link-status-unavailable' as const,
      })
    );
    if (status.isOk() && status.value === 'linked') {
      markStarted(false);
      backToSettings();
      return;
    }
    // Back from GitHub without a link: the user declined or it failed.
    if (wasStarted()) {
      markStarted(false);
      setPhase('failed');
      return;
    }
    await start();
  }

  onMount(() => fireAndForget(begin(), 'github-connect'));

  return (
    <div class="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <Switch>
        <Match when={phase() === 'starting'}>
          <p class="text-sm text-ink-muted" role="status">
            {t('githubConnect.connecting')}
          </p>
        </Match>
        <Match when={phase() === 'in-browser'}>
          <p class="text-sm text-ink-muted" role="status">
            {t('githubConnect.inBrowser')}
          </p>
          <Button variant="secondary" size="sm" onClick={backToSettings}>
            {t('githubConnect.backToSettings')}
          </Button>
        </Match>
        <Match when={phase() === 'failed'}>
          <p class="text-sm text-ink" role="alert">
            {t('githubConnect.failed')}
          </p>
          <div class="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={() => fireAndForget(start(), 'github-connect')}
            >
              {t('githubConnect.tryAgain')}
            </Button>
            <Button variant="secondary" size="sm" onClick={backToSettings}>
              {t('githubConnect.backToSettings')}
            </Button>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
