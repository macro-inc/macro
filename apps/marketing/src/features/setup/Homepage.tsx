import { lazy, Show, Suspense } from 'solid-js';
import { demoHref, handleDemoClick } from '../../app/utils/utilCta';
import { setPageSeo } from '../../app/utils/utilSeo';
import { FeatureUiStyles } from '../marketing/components/FeaturePage';
import { HomepageResources } from '../marketing/components/HomepageResources';
import { HomepageTrustBadges } from '../marketing/components/HomepageTrustBadges';
import { HomepageTour } from '../marketing/components/homepage/HomepageTour';
import { SiteHeader } from '../marketing/components/SiteHeader';
import { wallpapers } from '../marketing/components/TutorialWallpaper';
import { routePhoneToMobileSignup } from '../marketing/core/navigation';
import '../marketing/components/homepage/macro-homepage.css';
import '../marketing/components/page-aura.css';

const HomepageSections = lazy(() =>
  import('../marketing/components/HomepageSections').then((module) => ({
    default: module.HomepageSections,
  }))
);

/**
 * The homepage follows the Email page: a centered introduction, a tour of the
 * product on its wallpapers, then one reading-width section per product.
 */
export function Homepage(props: { embedded?: boolean } = {}) {
  setPageSeo({
    title: 'Macro — The unified workspace for your company.',
    description:
      'Email, messages, tasks, and agents in one inbox. CRDT documents with live agent edits, workspace search and memory, and a CRM built from your email.',
    path: '/',
  });
  return (
    <div class="macro-homepage">
      <FeatureUiStyles scope=".macro-homepage" />
      <Show when={!props.embedded}>
        <SiteHeader currentPath="/" />
      </Show>
      <main
        class="macro-home-scroll page-outline-layout"
        data-onboarding-scroll
      >
        <div
          class="page-aura feature-page"
          data-product-spacing="true"
          style={{
            '--page-aura-primary': wallpapers.home.colors[1],
            '--page-aura-secondary': wallpapers.home.colors[2],
            '--page-aura-deep': wallpapers.home.colors[3],
          }}
        >
          <header
            class="feature-page-hero macro-home-hero"
            aria-labelledby="macro-home-title"
          >
            <h1 id="macro-home-title" data-welcome-heading>
              The unified workspace <br />
              for your company.
            </h1>
            <h2 class="macro-home-tagline">
              <span class="macro-home-tagline-desktop">
                Macro replaces 27+ apps with one connected <br />
                system for humans and agents.
              </span>
              <span class="macro-home-tagline-mobile">
                Macro is email, chat, docs, tasks, calendar, calls and CRM in
                one workspace, with agents that work across all of it.
                Everything links to everything else.
              </span>
            </h2>
            <div class="macro-home-actions">
              <a
                class="site-nav-start homepage-hero-cta"
                target="_self"
                href="/app/signup"
                onClick={routePhoneToMobileSignup}
              >
                Get Macro
              </a>
              <a
                class="macro-home-demo"
                href={demoHref()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleDemoClick('hero_book_demo')}
              >
                Book a demo
              </a>
            </div>
          </header>
          <HomepageTour />
          <HomepageTrustBadges showGithub />
          <Suspense>
            <HomepageSections />
          </Suspense>
        </div>
        <HomepageResources />
      </main>
    </div>
  );
}
