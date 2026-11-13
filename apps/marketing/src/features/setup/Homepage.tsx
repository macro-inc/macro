import { createMediaQuery } from '@solid-primitives/media';
import { lazy, Show, Suspense } from 'solid-js';
import { setPageSeo } from '../../app/utils/utilSeo';
import { FeatureUiStyles } from '../marketing/components/FeaturePage';
import { HomepageFeatureLinks } from '../marketing/components/HomepageFeatureLinks';
import { HomepageResources } from '../marketing/components/HomepageResources';
import { HomepageScrollCue } from '../marketing/components/HomepageScrollCue';
import { HomepageUnification } from '../marketing/components/HomepageUnification';
import {
  homepageDescription,
  MacroHero,
} from '../marketing/components/homepage/MacroHero';
import { SiteHeader } from '../marketing/components/SiteHeader';
import { wallpapers } from '../marketing/components/TutorialWallpaper';
import { routePhoneToMobileSignup } from '../marketing/core/navigation';
import { OnboardingShell } from './components/OnboardingShell';
import { WelcomeStep } from './components/WelcomeSteps';
import '../marketing/components/homepage/macro-homepage.css';
import '../marketing/components/page-aura.css';

const HomepageSections = lazy(() =>
  import('../marketing/components/HomepageSections').then((module) => ({
    default: module.HomepageSections,
  }))
);

/** Keep the deployed mobile landing flow separate from the compact desktop hero. */
export function Homepage(props: { embedded?: boolean } = {}) {
  const mobile = createMediaQuery('(max-width: 699px)', false);
  setPageSeo({
    title: 'Macro — The unified workspace for your company.',
    description:
      'Email, messages, tasks, and agents in one inbox. CRDT documents with live agent edits, workspace search and memory, and a CRM built from your email.',
    path: '/',
  });
  return (
    <div class="macro-homepage">
      <FeatureUiStyles scope=".macro-homepage" />
      <Show
        when={mobile()}
        fallback={
          <>
            <Show when={!props.embedded}>
              <SiteHeader currentPath="/" />
            </Show>
            <main
              class="macro-home-scroll page-outline-layout"
              data-onboarding-scroll
            >
              <div
                class="page-aura"
                style={{
                  '--page-aura-primary': wallpapers.home.colors[1],
                  '--page-aura-secondary': wallpapers.home.colors[2],
                  '--page-aura-deep': wallpapers.home.colors[3],
                }}
              >
                <HomepageFeatureLinks />
                <section
                  class="macro-home-hero"
                  aria-labelledby="macro-home-title"
                >
                  <MacroHero />
                </section>
                <Suspense>
                  <HomepageSections />
                </Suspense>
              </div>
              <HomepageResources />
            </main>
          </>
        }
      >
        <OnboardingShell
          wide
          landing
          hideHeader={props.embedded}
          heroFooter={<HomepageScrollCue />}
          below={
            <>
              <HomepageUnification />
              <Suspense>
                <HomepageSections />
              </Suspense>
            </>
          }
        >
          <WelcomeStep
            description={homepageDescription}
            onContinue={() => {}}
            action={
              <div class="homepage-hero-action mt-6 flex justify-center pb-5">
                <a
                  class="site-nav-start homepage-hero-cta"
                  href="/app/signup"
                  onClick={routePhoneToMobileSignup}
                >
                  Get Started
                </a>
              </div>
            }
          />
        </OnboardingShell>
      </Show>
    </div>
  );
}
