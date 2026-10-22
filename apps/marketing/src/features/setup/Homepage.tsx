import { HomepageBlog } from '../marketing/components/HomepageBlog';
import { HomepageClosing } from '../marketing/components/HomepageClosing';
import { HomepageTestimonials } from '../marketing/components/HomepageTestimonials';
import { HomepageTiles } from '../marketing/components/homepage/HomepageTiles';
import { MacroHero } from '../marketing/components/homepage/MacroHero';
import { SiteHeader } from '../marketing/components/SiteHeader';
import { routePhoneToMobileSignup } from '../marketing/core/navigation';
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
        </section>
        <section
          class="macro-letter-intro macro-letter-prose"
          aria-label="Why Macro"
        >
          <p>
            We built Macro so a small team can run the company without juggling
            a dozen apps. Email, chat, docs, tasks, and customer records live
            together. Turn a customer conversation into a task, share it with
            your team, and keep the context attached.
          </p>
          <p>
            Your agents work in that same system. Ask them to draft a reply,
            update a document, or take on a task using what your team already
            knows. Less copying, fewer status updates, and no explaining your
            company from scratch in every AI chat.
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
      </main>
    </div>
  );
}
