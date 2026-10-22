import Logo from '@icon/macro-logo.svg';
import { For } from 'solid-js';
import wordmark from '../../assets/logos/macro-wordmark.svg?url';
import { HomepageBlog } from '../marketing/components/HomepageBlog';
import { HomepageClosing } from '../marketing/components/HomepageClosing';
import { HomepageTestimonials } from '../marketing/components/HomepageTestimonials';
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
  let closingRoot!: HTMLDivElement;
  return (
    <div class="macro-homepage">
      <SiteHeader />
      <main class="macro-home-scroll" data-onboarding-scroll>
        <section class="macro-home-hero" aria-labelledby="macro-home-title">
          <MacroHero />
          <h1 id="macro-home-title" data-welcome-heading>
            <img src={wordmark} alt="Macro" width="632" height="85" />
          </h1>
          <a
            class="macro-home-button"
            href="/app/signup"
            onClick={routePhoneToMobileSignup}
          >
            Get started
          </a>
          <p class="macro-home-tagline">
            Email, chat, docs, tasks, and agents.
            <br />
            One beautifully connected workspace.
          </p>
        </section>
        <HomepageTiles />
        <div class="macro-home-bottom" ref={closingRoot}>
          <HomepageTestimonials />
          <HomepageBlog />
          <HomepageClosing root={() => closingRoot} />
        </div>
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
