/** Public homepage and shared signup introduction. Connections continue in the app. */
import '../../index.css';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { DEFAULT_DARK_THEME } from '@theme/constants';
import { clearThemePreview, previewTheme } from '@theme/utils/themeUtils';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { analytics } from '../../../marketing/src/app/utils/utilAnalytic';
import { buildAppUrl } from '../../../marketing/src/app/utils/utilBaseUrl';
import { HomepageScrollCue } from '../marketing/components/HomepageScrollCue';
import { HomepageSections } from '../marketing/components/HomepageSections';
import { HomepageUnification } from '../marketing/components/HomepageUnification';
import { OnboardingShell } from './components/OnboardingShell';
import { WelcomeStep } from './components/WelcomeSteps';
import { PublicOnboarding } from './views/PublicOnboarding';

function Preview() {
  previewTheme(DEFAULT_DARK_THEME);
  onCleanup(clearThemePreview);
  if (window.location.pathname !== '/') {
    const loginUrl = new URL(
      import.meta.env.DEV
        ? `/app/login${window.location.search}`
        : buildAppUrl('/app/login'),
      window.location.origin
    );
    const params = new URLSearchParams(window.location.search);
    for (const key of ['next', 'referral_code']) {
      const value = params.get(key);
      if (value) loginUrl.searchParams.set(key, value);
    }
    return (
      <PublicOnboarding
        loginUrl={loginUrl.toString()}
        preview={import.meta.env.DEV}
        onFeaturesSelected={(features) =>
          analytics.trackPosthog('onboarding_v4_features_selected', {
            features,
            feature_count: features.length,
            source: 'public_onboarding',
          })
        }
      />
    );
  }

  const [motionSpeed, setMotionSpeed] = createSignal(1);
  let replayHero: ((duration: number) => void) | undefined;
  return (
    <>
      <OnboardingShell
        wide
        landing
        heroFooter={<HomepageScrollCue />}
        below={
          <>
            <HomepageUnification
              onPreviewReady={
                import.meta.env.DEV
                  ? (replay) => {
                      replayHero = replay;
                    }
                  : undefined
              }
            />
            <HomepageSections />
          </>
        }
      >
        <WelcomeStep
          onContinue={() => {}}
          action={
            <div class="homepage-hero-action mt-6 flex justify-center pb-5">
              <a
                class="site-nav-start homepage-hero-cta"
                href={import.meta.env.DEV ? '/onboarding-preview.html' : '/app'}
              >
                Get Started
              </a>
            </div>
          }
        />
      </OnboardingShell>
      {import.meta.env.DEV && (
        <details class="fixed bottom-3 right-5 z-modal rounded-2xl border border-edge bg-surface p-2 text-[10px] text-ink-muted">
          <summary>Preview controls</summary>
          <a
            href="/onboarding-preview.html"
            class="block rounded-full px-2 py-1"
          >
            Preview onboarding
          </a>
          <button
            type="button"
            class="rounded-full px-2 py-1"
            onClick={() => replayHero?.(1400 / motionSpeed())}
          >
            Replay hero → features
          </button>
          <label>
            Motion speed{' '}
            <select
              aria-label="Motion speed"
              class="bg-surface"
              value={motionSpeed()}
              onChange={(event) =>
                setMotionSpeed(Number(event.currentTarget.value))
              }
            >
              <option value="1">1×</option>
              <option value="0.25">¼×</option>
              <option value="0.1">⅒×</option>
            </select>
          </label>
        </details>
      )}
    </>
  );
}
const root = document.getElementById('root');
if (root) {
  root.textContent = '';
  render(
    () => (
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <Preview />
      </QueryClientProvider>
    ),
    root
  );
  root.dataset.publicReady = 'true';
}
