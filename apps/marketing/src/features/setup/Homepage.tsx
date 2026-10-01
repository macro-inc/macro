import { createSignal } from 'solid-js';
import { HomepageScrollCue } from '../marketing/components/HomepageScrollCue';
import { HomepageSections } from '../marketing/components/HomepageSections';
import { HomepageUnification } from '../marketing/components/HomepageUnification';
import { OnboardingShell } from './components/OnboardingShell';
import { WelcomeStep } from './components/WelcomeSteps';

/** Shared build-time and browser tree: hydration preserves the first-painted hero. */
export function Homepage() {
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
