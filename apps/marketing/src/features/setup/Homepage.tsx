import Logo from '@icon/macro-logo.svg';
import { For } from 'solid-js';
import { HomepageTiles } from '../marketing/components/homepage/HomepageTiles';
import { MacroHero } from '../marketing/components/homepage/MacroHero';
import { SiteHeader } from '../marketing/components/SiteHeader';
import {
  FEATURE_PAGES,
  RESOURCE_PAGES,
  routePhoneToMobileSignup,
} from '../marketing/core/navigation';
import '../marketing/components/homepage/macro-homepage.css';

/** Shared build-time and browser tree: hydration preserves the first-painted hero. */
export function Homepage() {
  return (
    <div class="macro-homepage">
      <SiteHeader />
      <main class="macro-home-scroll" data-onboarding-scroll>
        <section class="macro-home-hero" aria-labelledby="macro-home-title">
          <MacroHero />
          <h1 id="macro-home-title" data-welcome-heading>
            Macro
          </h1>
          <a
            class="macro-home-button"
            href="/app/signup"
            onClick={routePhoneToMobileSignup}
          >
            Get started
          </a>
          <p class="macro-home-tagline">
            Your people. Your projects.
            <br />
            Your AI. All together.
          </p>
          <p class="macro-home-description">
            Email, chat, docs, tasks, and agents.
            <br />
            One beautifully connected workspace.
          </p>
        </section>
        <HomepageTiles />
        <section
          class="macro-home-closing"
          aria-labelledby="macro-closing-title"
        >
          <Logo aria-hidden="true" />
          <h2 id="macro-closing-title">A place for your best work.</h2>
          <a
            class="macro-home-button"
            href="/app/signup"
            onClick={routePhoneToMobileSignup}
          >
            Get started
          </a>
          <a class="macro-home-pricing" href="/pricing">
            Explore plans and pricing
          </a>
        </section>
        <footer class="macro-home-footer">
          <a class="macro-footer-brand" href="/" aria-label="Macro home">
            <Logo aria-hidden="true" />
            Macro
          </a>
          <nav aria-label="Footer navigation">
            <For
              each={[
                ...FEATURE_PAGES,
                ...RESOURCE_PAGES,
                { href: '/pricing', label: 'Pricing' },
                { href: '/partners', label: 'Partners' },
                { href: '/privacy', label: 'Privacy' },
                { href: '/terms', label: 'Terms' },
                { href: '/delete-account', label: 'Delete account' },
              ]}
            >
              {(link) => <a href={link.href}>{link.label}</a>}
            </For>
          </nav>
          <span>Made for working together.</span>
        </footer>
      </main>
    </div>
  );
}
