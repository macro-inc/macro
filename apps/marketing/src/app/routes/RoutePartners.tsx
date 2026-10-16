import { A } from '@solidjs/router';
import { type Component, createSignal, Show } from 'solid-js';
import LogoA16z from '../../assets/logos/a16z-artdeco.svg';
import LogoBoxGroup from '../../assets/logos/boxgroup.svg';
import LogoNyu from '../../assets/logos/nyu.svg';
import LogoWaterloo from '../../assets/logos/waterloo.svg';
import partnerAnnouncementVideo from '../../assets/partners/partnership-program-announcement.mp4';
import partnerAnnouncementPoster from '../../assets/partners/partnership-program-poster.jpg';
import { HomeSectionRule } from '../components/sections/HomeSectionRule';
import { type FaqItem, SectionFaq } from '../components/sections/SectionFaq';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { buildCalLinkWithAttribution } from '../utils/utilAnalytic';
import { demoHref } from '../utils/utilCta';
import { setPageSeo } from '../utils/utilSeo';
import '../../routes/posts/posts-shell.css';
import './partners-hero.css';

const SUPPORT_EMAIL = 'support@macro.com';
const KICKOFF_URL = 'https://cal.com/team/macro/partnerships-program';

const partnerFaq: FaqItem[] = [
  {
    q: 'What does it cost to join?',
    a: (
      <>
        The Macro Partnership costs $100 a year mostly as a filter for serious
        candidates. Eligible applicants and open source contributors maybe have
        this fee waived.
      </>
    ),
  },
  {
    q: 'How much do I get paid for referrals?',
    a: (
      <>
        30% of first year revenue for every new paying user that you bring to
        us.
      </>
    ),
  },
  {
    q: 'How do I claim a referral?',
    a: (
      <>
        After you&apos;ve referred someone, submit the claim through the process
        we designate — email, a form, or a partner portal. You don&apos;t
        register deals in advance to lock them. Credit goes to the partner who
        made the referral.
      </>
    ),
  },
  {
    q: 'When do referral fees get paid?',
    a: (
      <>
        Quarterly. Generally within 45 days after the end of each calendar
        quarter. You&apos;ll need to give us payment details and a W-9, W-8, or
        equivalent tax form before the first payout.
      </>
    ),
  },
  {
    q: 'Can I white-label Macro?',
    a: (
      <>
        White-labeling is not currently supported in Macro. However, if you
        would like to join the wait list for a white-labeled version, please
        email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </>
    ),
  },
  {
    q: 'What can I call myself?',
    a: (
      <>
        An &ldquo;Official Macro Partner,&rdquo; using the approved badges and
        brand kit. Official Macro Partners will gain exclusive product previews
        and event invites.
      </>
    ),
  },
  {
    q: 'Do partners get access to customer data?',
    a: (
      <>
        No. Program membership doesn&apos;t grant access to internal Macro
        customer data.
      </>
    ),
  },
  {
    q: 'Is our workspace data secure?',
    a: (
      <>
        Yes. Open source means the Macro application code is available to
        inspect. It does not make your workspace public. Data in your Macro
        account, including your team&apos;s email, documents, messages, and
        other workspace content, remains private and secure. For more
        information on security in Macro please visit our{' '}
        <a
          href="https://docs.macro.com/security"
          target="_blank"
          rel="noreferrer"
        >
          docs page
        </a>
        .
      </>
    ),
  },
];

function PartnerCtaBar() {
  return (
    <div class="partners-actions">
      <a
        class="partners-action partners-action-primary"
        href={buildCalLinkWithAttribution(KICKOFF_URL)}
        target="_blank"
        rel="noreferrer"
      >
        Book a kickoff call
      </a>
      <a
        class="partners-action partners-action-secondary"
        href="mailto:partner@macro.com"
      >
        Get in touch
      </a>
    </div>
  );
}

function PartnerAnnouncementPlayer() {
  let videoRef!: HTMLVideoElement;
  const [playing, setPlaying] = createSignal(false);
  function handlePlay() {
    videoRef
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }

  return (
    <div class="partners-video-frame">
      <video
        ref={videoRef}
        controls={playing()}
        onEnded={() => setPlaying(false)}
        onError={() => setPlaying(false)}
        playsinline
        poster={partnerAnnouncementPoster}
        preload="metadata"
        src={partnerAnnouncementVideo}
        aria-label="Partnership program announcement from Macro"
      />
      <Show when={!playing()}>
        <button
          class="partners-play"
          onClick={handlePlay}
          aria-label="Play Macro Partnership Overview"
        >
          <span class="partners-play-icon" aria-hidden="true">
            ▶
          </span>
          <span>Macro Partnership Overview</span>
        </button>
      </Show>
    </div>
  );
}

export const RoutePartners: Component = () => {
  setPageSeo({
    title: 'Macro Partner Program — Refer, Implement, and Build on Macro',
    description:
      'Join the Macro Partner Program: official partner status, a directory listing, demo and early access, and 30% of first-year subscription revenue on every qualified referral.',
    path: '/partners',
  });

  return (
    <>
      <style>{`
        @media (hover) {
          .partners-cta-bar .home-hero-cta:hover { transform: scale(1.02); }
          .partners-terms-link:hover { color: var(--c1); }
        }
        .partners-header-cta {
          display: flex;
          justify-content: flex-start;
          margin-top: 28px;
        }
        .posts-article-header .posts-title {
          font-family: display, Georgia, serif;
          font-size: clamp(22px, 2.8vw, 28px);
          font-weight: calc(370 + var(--cream-slab-weight-increase, 0));
          letter-spacing: -0.012em;
          line-height: 1.25;
          margin-left: 0;
          margin-right: 0;
          max-width: 25.2em;
          text-align: left;
          text-wrap: pretty;
        }
        .posts-article-header .partners-subtitle {
          color: var(--c4);
          font-family: Inter, system-ui, sans-serif;
          font-size: clamp(16px, 1.8vw, 18px);
          font-weight: 300;
          letter-spacing: -0.01em;
          line-height: 1.6;
          margin-left: 0;
          margin-right: 0;
          margin-top: 14px;
          margin-bottom: 0;
          max-width: 34em;
          text-align: left;
          text-wrap: pretty;
        }
        .posts-article-header .posts-hero-art {
          margin-bottom: 0;
          padding: 0;
        }
        .posts-article-header .posts-lede {
          margin-top: 28px;
        }
        .partners-logos {
          align-items: center;
          display: flex;
          flex-wrap: wrap;
          gap: 22px 36px;
          justify-content: center;
          list-style: none;
          margin: 36px 0 0;
          overflow: visible;
          padding: 0;
          width: 100%;
        }
        .partners-logos li {
          align-items: center;
          display: flex;
          flex: none;
          overflow: visible;
        }
        .partners-logos svg {
          color: var(--c1);
          display: block;
          flex: none;
          height: 22px;
          max-width: none;
          opacity: 0.88;
          overflow: visible;
          width: auto;
        }
        .partners-logos .partners-logo-boxgroup {
          aspect-ratio: 145 / 56;
          height: 28px;
        }
        .partners-logos .partners-logo-a16z {
          aspect-ratio: 75.8 / 24;
          height: 20px;
        }
        .partners-logos .partners-logo-waterloo {
          aspect-ratio: 192.05 / 23.61;
          height: 16px;
        }
        .partners-logos .partners-logo-nyu {
          aspect-ratio: 105.71 / 36;
          height: 22px;
        }
        @media (max-width: 699px) {
          .partners-logos { gap: 18px 24px; margin-top: 28px; }
          .partners-logos svg { height: 16px; }
          .partners-logos .partners-logo-boxgroup { height: 22px; }
          .partners-logos .partners-logo-waterloo { height: 13px; }
          .partners-logos .partners-logo-a16z { height: 16px; }
          .partners-logos .partners-logo-nyu { height: 18px; }
        }
        .partners-video-frame {
          aspect-ratio: 16 / 9;
          background: var(--b0);
          border-radius: 0;
          overflow: hidden;
          position: relative;
          width: 100%;
        }
        .partners-video-frame--idle::before,
        .partners-video-frame--idle::after {
          content: '';
          pointer-events: none;
          position: absolute;
          top: 0;
          bottom: 0;
          width: 28%;
          z-index: 1;
        }
        .partners-video-frame--idle::before {
          background: linear-gradient(
            to right,
            var(--b0) 0%,
            var(--b0) 14%,
            transparent 100%
          );
          left: 0;
        }
        .partners-video-frame--idle::after {
          background: linear-gradient(
            to left,
            var(--b0) 0%,
            var(--b0) 14%,
            transparent 100%
          );
          right: 0;
        }
        .partners-video-frame--idle video {
          filter: grayscale(1);
        }
        .partners-video-frame video {
          background: var(--b1);
          border: 0;
          display: block;
          height: 100%;
          object-fit: cover;
          object-position: center center;
          width: 100%;
        }
        .partners-steps {
          color: var(--c4);
          font-family: Inter, system-ui, sans-serif;
          font-size: 17px;
          font-weight: 300;
          letter-spacing: -0.01em;
          line-height: 1.6;
          margin: 0 auto 40px;
          max-width: 680px;
          padding-left: 22px;
          text-align: left;
        }
        .partners-steps li {
          margin-bottom: 8px;
          padding-left: 6px;
        }
        .partners-steps a {
          color: var(--a0);
          text-decoration: none;
        }
        .partners-steps a:hover {
          color: var(--c1);
        }
        .post-body > .partners-audience-block {
          align-items: center;
          display: flex;
          flex-direction: column;
          margin: 0 0 24px;
          text-align: center;
          width: 100%;
        }
        .partners-audience-block .partners-audience {
          margin: 0 !important;
          max-width: none;
          text-align: center;
          width: 100%;
        }
        .partners-audience-block .partners-logos {
          margin-top: 28px;
        }
        @media (max-width: 699px) {
          .partners-steps {
            font-size: 16px;
            margin-bottom: 32px;
            padding-left: 20px;
          }
        }
        .partners-faq {
          margin-top: 76px;
        }
        .partners-faq .faq__item:last-child > summary {
          padding-bottom: 34px;
        }
        @media (max-width: 699px) {
          .partners-faq .faq__item:last-child > summary {
            padding-bottom: 28px;
          }
        }
        .partners-faq > section {
          background-color: transparent !important;
          padding: 0 !important;
        }
        .partners-faq > section > div:last-child {
          max-width: none;
        }
        .posts-shell .partners-terms-link {
          color: color-mix(in srgb, var(--c4) 70%, transparent);
          font-family: body, system-ui, sans-serif;
          font-size: 14px;
          font-weight: 500;
        }
        .post-body strong {
          color: var(--a0);
          font-weight: 500;
        }
        .post-body h2::before,
        .post-body h3::before {
          content: none;
          display: none;
        }
      `}</style>

      <article class="posts-shell posts-article posts-article--with-footer partners-article">
        <header class="posts-article-header partners-hero">
          <div class="partners-hero-copy">
            <h1 class="posts-title">Build your business with Macro.</h1>
            <h2 class="partners-subtitle">
              Help clients adopt Macro. Earn on referrals and get early access
              to new features.
            </h2>
            <div class="partners-header-cta">
              <PartnerCtaBar />
            </div>
          </div>
          <div class="posts-hero-art">
            <PartnerAnnouncementPlayer />
          </div>
        </header>

        <div class="post-body">
          <div class="partners-audience-block">
            <p class="posts-lede partners-audience">
              We partner with system integrators, consultants, agencies,
              developers, IT consultants, open source contributors, influencers,
              venture funds, accelerators, and incubators.
            </p>
            <ul class="partners-logos" aria-label="Backed by">
              <li>
                <LogoBoxGroup
                  class="partners-logo-boxgroup"
                  aria-label="BoxGroup"
                />
              </li>
              <li>
                <LogoA16z
                  class="partners-logo-a16z"
                  aria-label="Andreessen Horowitz"
                />
              </li>
              <li>
                <LogoWaterloo
                  class="partners-logo-waterloo"
                  aria-label="University of Waterloo"
                />
              </li>
              <li>
                <LogoNyu
                  class="partners-logo-nyu"
                  aria-label="New York University"
                />
              </li>
            </ul>
          </div>

          <h2>Why become a Macro partner?</h2>
          <p>
            Macro combines docs, tasks, email, calendar, calls, messaging, CRM,
            and agents. Partners can help clients migrate their work, configure
            channel access, and use agents to edit documents and update customer
            records. The code is open source, so you can inspect and extend the
            product you recommend.
          </p>
          <p>
            Our product is completely open source and holds an AGPLv3 license.
            Partners interested in setting up a self-hosted workspace for their
            clients can email{' '}
            <a href="mailto:contact@macro.com">contact@macro.com</a> to get
            started.
          </p>
          <p>
            As a Macro partner, you will receive <strong>30%</strong> of a
            referred new user&apos;s first-year subscription revenue. You will
            also gain access to product resources, new feature previews, partner
            events, and are able to call yourself an official Macro Partner.
          </p>

          <h2>Where partners come in.</h2>
          <p>
            System integrators, consultants, and agencies help clients set up
            Macro and bring their existing work into it. Email, documents,
            tasks, and customer records use one workspace, with shared
            navigation, search, and agent tools.
          </p>

          <h2>How to become a partner</h2>
          <ol class="partners-steps">
            <li>
              <span>
                Book a partner screening call with our team{' '}
                <a href={demoHref()} target="_blank" rel="noreferrer">
                  here
                </a>
                .
              </span>
            </li>
            <li>
              <span>Get approved as a partner.</span>
            </li>
            <li>
              <span>Roll out Macro to your clients.</span>
            </li>
          </ol>

          <div class="partners-faq">
            <SectionFaq items={partnerFaq} hideHeading />
          </div>
        </div>
      </article>

      <HomeSectionRule />
      <div class="posts-home-cta-wrap posts-shell">
        <section class="partners-closing-cta" aria-label="Become a partner">
          <div class="posts-home-cta-copy">
            <h2>Become a Macro partner.</h2>
          </div>
          <PartnerCtaBar />
          <A href="/partners/terms" class="partners-terms-link">
            Full partner program terms
          </A>
        </section>
      </div>
      <div class="posts-page-footer posts-shell">
        <SectionMoreFeatures currentPath="/partners" footerOnly />
      </div>
    </>
  );
};
