import Logo from '@icon/macro-logo.svg';
import { For } from 'solid-js';
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
          <h1 id="macro-home-title" data-welcome-heading>
            One workspace for your team and your agents.
          </h1>
          <p class="macro-home-tagline">
            Email, chat, docs, tasks, CRM, calls, and sheets. <br />
            Built together, so they actually work together.
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
            We built Macro because we wanted one system that actually worked
            together. Fast email, good team chat, simple docs and tasks. Each
            should be useful on its own, and better because the others are
            there.
          </p>
          <p>
            You shouldn’t have to screenshot an email to discuss it with your
            team. Or copy a conversation into a task, then go back and update
            everyone when it’s done. In Macro, you can mention the original. The
            link works in both directions, and sharing it in a channel gives
            that channel access.
          </p>
          <p>
            That matters for agents, too. They need more than your chat history.
            Macro builds shared memory from the work your team is doing, with
            tools to search it and act on it. Emails, messages, assignments, and
            agent replies come back to one inbox, split into Signal and Noise.
            Less time keeping the software up to date. More time doing the work.
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
