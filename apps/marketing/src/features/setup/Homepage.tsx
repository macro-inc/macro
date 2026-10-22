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
            One workspace for your team and your agents.
          </h1>
          <p class="macro-home-tagline">
            Email, chat, docs, tasks, CRM, calls, and sheets. In Macro, they
            share the same workspace, so you and your agents can work across
            them.
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
            A customer sends an email. You discuss it in chat, write a plan in a
            document, create tasks, and update the CRM.
          </p>
          <p>
            When each step lives in a different app, someone has to carry the
            context between them. You forward the thread, paste the link, and
            explain the same thing again when you ask an agent for help.
          </p>
          <p>
            Macro puts that work in one workspace. Share the email in a channel.
            Link the plan to the task. Give an agent the conversation and the
            documents it needs to act.
          </p>
          <p class="macro-letter-transition">Here’s how that works.</p>
        </section>
        <HomepageTiles />
        <div class="macro-home-bottom" ref={closingRoot}>
          <section
            class="macro-letter-prose macro-letter-proof"
            aria-labelledby="macro-open-source-title"
          >
            <h2 id="macro-open-source-title">Open source.</h2>
            <p>
              Macro’s source code is on GitHub. You can inspect the code, report
              issues, and contribute changes.
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
              Bring in the email, the plan, and the people working on it. Share
              a thread, create a task, and ask an agent to help with the next
              step. You can try the workflow before moving the rest of your
              team’s work.
            </p>
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
