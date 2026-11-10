import { lazy, Show, Suspense } from 'solid-js';
import { setPageSeo } from '../../app/utils/utilSeo';
import { FeatureUiStyles } from '../marketing/components/FeaturePage';
import { HomepageUnification } from '../marketing/components/HomepageUnification';
import { MacroHero } from '../marketing/components/homepage/MacroHero';
import { SiteHeader } from '../marketing/components/SiteHeader';
import { wallpapers } from '../marketing/components/TutorialWallpaper';
import { ContextScene } from './components/WelcomeSteps';
import '../marketing/components/homepage/macro-homepage.css';
import '../marketing/components/page-aura.css';

const HomepageSections = lazy(() =>
  import('../marketing/components/HomepageSections').then((module) => ({
    default: module.HomepageSections,
  }))
);

/** Shared build-time and browser tree: hydration preserves the first-painted hero. */
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
      <main class="macro-home-scroll" data-onboarding-scroll>
        <div
          class="page-aura"
          style={{
            '--page-aura-primary': wallpapers.home.colors[1],
            '--page-aura-secondary': wallpapers.home.colors[2],
            '--page-aura-deep': wallpapers.home.colors[3],
          }}
        >
          <section class="macro-home-hero" aria-labelledby="macro-home-title">
            <ContextScene />
            <MacroHero />
          </section>
          <HomepageUnification />
          <Suspense>
            <HomepageSections />
          </Suspense>
        </div>
      </main>
    </div>
  );
}
