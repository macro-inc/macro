import { onCleanup } from 'solid-js';
import { isServer } from 'solid-js/web';
import { handleDemoClick } from '../../../app/utils/utilCta';
import { setPageSeo } from '../../../app/utils/utilSeo';
import { FeatureConstellation } from '../../setup/components/FeatureOverview';
import { WelcomeStep } from '../../setup/components/WelcomeSteps';
import { FeaturePage } from '../components/FeaturePage';
import { HomepageTrustBadges } from '../components/HomepageTrustBadges';
import { DemoBookingEmbed } from '../components/sales/DemoBookingEmbed';
import { SalesCalculator } from '../components/sales/SalesCalculator';
import { formatWholeUsd } from '../core/sales-savings';
import { MACRO_SEAT_CENTS } from '../core/savings-calculator';
import '../components/homepage-scroll-cue.css';
import '../components/homepage-unification.css';
import '../components/workspace-story.css';
import '../../setup/cream-preview.css';
import './sales-page.css';

/** `OnboardingShell`'s palette, which the homepage hero is drawn in. */
const SHELL_PALETTE = {
  '--color-surface': '#000',
  '--color-ink': '#fff',
  '--color-ink-muted': '#a8a8a8',
  '--color-ink-extra-muted': '#737373',
  '--color-edge': '#292929',
  '--color-edge-muted': '#1c1c1c',
  '--color-accent': 'var(--color-ink)',
};

/** Section heading in the "Replace 27+ apps" format from `HomepageUnification`. */
function TourHeading(props: {
  id: string;
  title: string;
  description: string;
}) {
  return (
    <div class="unification-copy tour-heading" style={SHELL_PALETTE}>
      <h2 id={props.id}>{props.title}</h2>
      <p class="unification-subtext">{props.description}</p>
    </div>
  );
}

/** Every demo CTA scrolls to the inline booker instead of leaving the page. */
function bookDemo(buttonName: string) {
  handleDemoClick(buttonName);
  document
    .getElementById('book')
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function RouteTour() {
  setPageSeo({
    title: 'Macro — Email, Docs, Tasks, and Agents in One App',
    description:
      'Replace Notion, Linear, and Superhuman with one workspace for email, chat, documents, tasks, CRM, and agents. Book a demo.',
    path: '/tour',
    noindex: true,
  });
  // `?theme=cream` previews the page in the cream palette (cream-preview.css).
  const cream =
    !isServer &&
    new URLSearchParams(window.location.search).get('theme') === 'cream';
  if (cream) {
    const root = document.documentElement;
    const previousLight = root.dataset.themeLight;
    root.dataset.palette = 'cream';
    // Light glass (white rims, softer shadows) is keyed off <html>.
    root.dataset.themeLight = 'true';
    onCleanup(() => {
      delete root.dataset.palette;
      if (previousLight === undefined) delete root.dataset.themeLight;
      else root.dataset.themeLight = previousLight;
    });
  }

  return (
    <FeaturePage light={cream}>
      <div class="homepage-sections tour-page">
        <div class="homepage-sections-inner">
          {/* The homepage hero inside `OnboardingShell`'s palette and card. */}
          <div class="tour-hero" style={SHELL_PALETTE}>
            <div class="w-full sm:max-w-xl md:max-w-[720px]">
              <WelcomeStep
                onContinue={() => {}}
                title={
                  <>
                    The only app you need <br />
                    for your entire company.
                  </>
                }
                description={`Email, chat, documents, tasks, CRM, and agents in one workspace, for ${formatWholeUsd(MACRO_SEAT_CENTS)} a seat.`}
                action={
                  <div class="homepage-hero-action mt-6 flex justify-center pb-5">
                    <a
                      class="site-nav-start homepage-hero-cta tour-cta"
                      href="#book"
                      onClick={(event) => {
                        event.preventDefault();
                        bookDemo('tour_hero_book_demo');
                      }}
                    >
                      Book a demo
                    </a>
                  </div>
                }
              />
            </div>
          </div>

          {/* The homepage's `HomepageUnification` section, without its
              hero-to-section scroll animation. */}
          <section
            class="homepage-unification tour-constellation"
            aria-labelledby="unification-heading"
            style={SHELL_PALETTE}
          >
            <div class="unification-copy">
              <h2 id="unification-heading">
                Replace 27+ apps
                <br />
                with a single system.
              </h2>
              <p class="unification-subtext">
                <span class="unification-subtext-desktop">
                  From email and docs to booking links, databases, and coding
                  agents.
                  <br />
                  One search. Bidirectional links. Agent tools across your work.
                </span>
                <span class="unification-subtext-mobile">
                  From email to docs to booking links, databases, and coding
                  agents. One search. Linked work. Agents that can edit it.
                </span>
              </p>
            </div>
            {/* Phones get the compact 8-feature ring; the full grid is too busy. */}
            <div class="tour-constellation-desktop">
              <FeatureConstellation expanded />
            </div>
            <div class="tour-constellation-mobile">
              <FeatureConstellation />
            </div>
          </section>

          <section
            id="savings"
            class="homepage-feature tour-section"
            aria-labelledby="savings-title"
          >
            <TourHeading
              id="savings-title"
              title="One subscription instead of many."
              description="Choose your team size and the tools you pay for today. Every Macro plan includes every module."
            />
            <SalesCalculator
              onBook={() => bookDemo('tour_calculator_book_demo')}
            />
          </section>

          <section
            id="book"
            class="homepage-feature tour-section tour-booking"
            aria-labelledby="book-title"
          >
            <TourHeading
              id="book-title"
              title="See how to grow your business faster."
              description="A 30-minute call with our CEO or a member of our team. Pick a time below."
            />
            <DemoBookingEmbed id="tour-booking" cream={cream} />
          </section>

          <footer class="tour-footer">
            <HomepageTrustBadges />
          </footer>
        </div>
      </div>
    </FeaturePage>
  );
}
