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
          <div class="macro-home-wordmark">
            <img src={wordmark} alt="Macro" width="632" height="85" />
          </div>
          <h1 id="macro-home-title" data-welcome-heading>
            Why we built Macro.
          </h1>
          <p class="macro-home-tagline">
            Email, chat, docs, tasks, CRM, calls, and sheets. One workspace for
            your team and your agents.
          </p>
          <a
            class="macro-home-button"
            href="/app/signup"
            onClick={routePhoneToMobileSignup}
          >
            Get started
          </a>
          <MacroHero />
        </section>
        <section
          class="macro-letter-intro macro-letter-prose"
          aria-label="Why Macro"
        >
          <p>
            We built Macro because the pieces of a project belong together: the
            email that started it, the discussion, the plan, and the work
            itself.
          </p>
          <p>
            Spread those across separate apps and you become the connection
            between them. You copy things over, find the right link, and explain
            the background again.
          </p>
          <p>
            We want software to do more of that work. And we want agents to
            participate with the context they need to be useful. That’s why
            we’re building these tools as one system.
          </p>
        </section>
        <HomepageTiles />
        <div class="macro-home-bottom" ref={closingRoot}>
          <section
            class="macro-letter-prose macro-letter-proof"
            aria-labelledby="macro-open-source-title"
          >
            <h2 id="macro-open-source-title">Open source.</h2>
            <p>
              We’re asking you to trust Macro with your work. You should be able
              to inspect how it works and build on it. We’d want that as users,
              so we made the code open source.
            </p>
            <a
              href="https://github.com/macro-inc/macro"
              target="_blank"
              rel="noreferrer"
            >
              Explore the source ↗
            </a>
          </section>
          <HomepageTestimonials />
          <section
            class="macro-letter-prose macro-letter-close"
            aria-labelledby="macro-start-title"
          >
            <h2 id="macro-start-title">Start with one project.</h2>
            <p>
              Try it with something you’re already working on. We’d love to hear
              what works for you and what still gets in the way.
            </p>
            <p>— The Macro team</p>
            <a
              class="macro-home-button"
              href="/app/signup"
              onClick={routePhoneToMobileSignup}
            >
              Get started
            </a>
            <p class="macro-letter-postscript">
              Already have a workspace elsewhere?{' '}
              <a href="/migrate">Read the migration guide.</a>
            </p>
          </section>
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
