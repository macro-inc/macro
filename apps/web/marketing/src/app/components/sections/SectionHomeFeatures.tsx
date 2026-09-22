import { For, Show } from 'solid-js';
import { AiFeatureSection } from '../../routes/RouteEmail';
import { ChannelCohesionGraphic } from '../featureGraphics/ChannelsGraphics';
import {
  HeroDocCollabWindow,
  HomeMobileDocsShot,
} from '../featureGraphics/DocumentsGraphics';
import {
  ComposeMentionGraphic,
  HeroAppWindow,
} from '../featureGraphics/EmailGraphics';
import { SsgDesktop, SsgMobile } from '../utils/SsgGate';
import { EmailFeatureFigures } from './EmailFeatureFigures';
import { HomeSectionRule } from './HomeSectionRule';
import {
  type LoopsFeatureBlock,
  LoopsFeatureSection,
  loopsFeatureHoverStyles,
} from './LoopsFeatureSection';
import { SectionFeatureGrid } from './SectionFeatureGrid';
import { SectionFinalCta } from './SectionFinalCta';
import { SectionHomeBlog } from './SectionHomeBlog';
import { SectionHomeQuote } from './SectionHomeQuote';
import { SectionMoreFeatures } from './SectionMoreFeatures';
import { TasksFeatureCards } from './TasksFeatureCards';

// Linear-style composition: the full email inbox shot dimmed in the
// background, with the composer lifted and spotlit in front of it.
export function EmailSpotlightShot() {
  return (
    <>
      <SsgMobile>
        <div style={{ 'margin-top': '-12px' }}>
          <ComposeMentionGraphic />
        </div>
      </SsgMobile>
      <SsgDesktop>
        <div style={{ position: 'relative', width: '100%' }}>
          <div
            aria-hidden="true"
            style={{
              filter: 'saturate(0.85)',
              'mask-image':
                'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
              '-webkit-mask-image':
                'linear-gradient(to bottom, #000 0%, #000 70%, transparent 100%)',
              opacity: '0.42',
              'pointer-events': 'none',
            }}
          >
            <HeroAppWindow />
          </div>
          <div
            style={{
              'align-items': 'center',
              display: 'grid',
              inset: '0',
              'justify-items': 'start',
              position: 'absolute',
            }}
          >
            <div
              style={{
                'margin-left': '60px',
                'max-width': '500px',
                'padding-left': '3%',
                position: 'relative',
                transform: 'translateY(-20px)',
                width: '100%',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  background:
                    'radial-gradient(70% 70% at 50% 50%, color-mix(in srgb, var(--b1) 40%, var(--ambient-ink) 12%) 0%, transparent 72%)',
                  inset: '-14% -10%',
                  'pointer-events': 'none',
                  position: 'absolute',
                  'z-index': 0,
                }}
              />
              <div
                style={{
                  filter: 'drop-shadow(0 40px 80px rgb(0 0 0 / 0.55))',
                  position: 'relative',
                  'z-index': 1,
                }}
              >
                <ComposeMentionGraphic />
              </div>
            </div>
          </div>
        </div>
      </SsgDesktop>
    </>
  );
}

// Messages heroShot: the animated cohesion graphic (scripted) on every
// viewport, so its @mention styling and the share → click → open-panel
// sequence stay fully controllable from this repo.
function ChannelHeroShot() {
  return <ChannelCohesionGraphic />;
}

// The collaborative-doc window keeps a fixed editor measure that runs a touch
// past a phone's width; render it at its natural width and scale to fit so the
// realtime-edit copy doesn't clip on the right.
function DocsHomeShot() {
  return (
    <>
      <SsgMobile>
        <HomeMobileDocsShot />
      </SsgMobile>
      <SsgDesktop>
        <HeroDocCollabWindow />
      </SsgDesktop>
    </>
  );
}

export const homeFeatures: LoopsFeatureBlock[] = [
  {
    label: 'Email',
    headline: 'The fastest and smartest email client.',
    mobileHeadline: (
      <>
        Triage all your
        <br />
        email accounts in
        <br />
        one AI-native inbox.
      </>
    ),
    headlineSingleLine: true,
    description:
      'Get through your email faster with AI triage, keyboard shortcuts, auto-tagging, team sharing, and drafting in your voice.',
    href: '/email',
    heroShot: EmailSpotlightShot,
    heroBare: true,
    mobileGraphicTopPadding: '0',
    mobileCopyBelowGraphic: true,
  },
  {
    label: 'Documents',
    headline: 'Collaborative docs, built for agents.',
    mobileHeadline: (
      <>
        Write with your
        <br />
        team and agents in
        <br />
        live markdown docs.
      </>
    ),
    description:
      'Collaborate with your team and agents on CRDT-powered markdown documents live @linked to email, tasks, and channels.',
    href: '/documents',
    heroShot: DocsHomeShot,
    heroBare: true,
    mobileCopyBelowGraphic: true,
  },
  {
    label: 'Messages',
    headline: (
      <>
        Team chat built for focused{' '}
        <span class="home-messages-headline-deep">deep </span>work.
      </>
    ),
    mobileHeadline: (
      <>
        Chat with your team
        <br />
        without losing focus
        <br />
        on deep work.
      </>
    ),
    description:
      'Distraction-free team conversations @linked to tasks, docs and email, focused into Signal (priority) and Noise (check later) sections.',
    href: '/channels',
    heroShot: ChannelHeroShot,
    heroBare: true,
    hideSpotlightBackdrop: true,
    mobileGraphicTopPadding: '0',
    mobileCopyBelowGraphic: true,
  },
  {
    label: 'Tasks',
    headline: 'Tasks built around chat messages.',
    headlineSingleLine: true,
    mobileHeadline: (
      <>
        Turn chat messages
        <br />
        into tasks you can
        <br />
        actually close.
      </>
    ),
    description:
      'Tasks have instant access to email, chat, and docs. Keyboard-first, auto deduplicated, and closeable by agents.',
    desktopDescriptionMaxWidth: '580px',
    inlineExploreLink: true,
    href: '/tasks',
    heroShot: () => <TasksFeatureCards cardsOnly />,
    heroBare: true,
    hideSpotlightBackdrop: true,
    graphicTopPadding: '28px',
    mobileGraphicTopPadding: '0',
    mobileHideSpotlightBackdrop: true,
    mobileCopyBelowGraphic: true,
  },
  {
    label: 'CRM',
    headline: 'Unified team-level agent memory.',
    mobileHeadline: (
      <>
        Give your agents
        <br />
        shared memory of
        <br />
        every customer.
      </>
    ),
    description:
      'An agent-driven CRM that updates itself based on your comms, tasks, and docs. Effortlessly track leads, contacts, and deals.',
    href: '/crm',
  },
];

export function SectionHomeFeatureBlocks() {
  return <SectionFeatureGrid skipHero part="blocks" />;
}

export function SectionHomeFeatures() {
  return (
    <>
      <style>{`
        ${loopsFeatureHoverStyles()}
        @media (min-width: 700px) and (max-width: 1023px) {
          .home-messages-headline-deep {
            display: none;
          }
        }

        /* Viewport-dependent spacing/typography in CSS so the prerender is
           correct on phones before the JS bundle loads. */
        .home-features-block { padding-block: 72px; padding-inline: 24px; }
        .home-features-block--tasks { padding-bottom: 0; }
        .home-features-block--tasks .loops-band--spotlight { padding-bottom: 0; }
        .home-final-cta-pad { padding: 111px 24px 72px; }
        .home-footer-pad { padding: 0 24px 48px; }
        @media (max-width: 699px) {
          .home-features-block { padding-block: 64px; padding-inline: 18px; }
          .home-features-block--tasks { padding-bottom: 0; }
          .home-final-cta-pad { padding: 87px 18px 56px; }
          .home-footer-pad { padding: 0 18px 40px; }
        }
      `}</style>
      <div
        style={{
          display: 'grid',
          gap: '0',
          'grid-template-columns': 'minmax(0, 1fr)',
          'min-width': '0',
          width: '100%',
        }}
      >
        <For each={homeFeatures}>
          {(block, index) => (
            <>
              <Show when={index() > 0}>
                <HomeSectionRule />
              </Show>
              <Show
                when={block.label === 'CRM'}
                fallback={
                  <div
                    class="home-features-block"
                    classList={{
                      'home-features-block--tasks': block.label === 'Tasks',
                    }}
                    style={{
                      'box-sizing': 'border-box',
                    }}
                  >
                    <LoopsFeatureSection
                      block={block}
                      textLayout={
                        block.label === 'Tasks' ? 'stacked-hero' : 'split'
                      }
                      spotlight={Boolean(block.heroShot)}
                    />
                    <Show when={block.label === 'Email'}>
                      <SsgDesktop>
                        <div style={{ 'margin-top': '25px' }}>
                          <EmailFeatureFigures />
                        </div>
                      </SsgDesktop>
                    </Show>
                  </div>
                }
              >
                <AiFeatureSection flushBottom hideFig />
              </Show>
              <Show when={block.label === 'Messages'}>
                <HomeSectionRule />
                <SectionHomeQuote />
              </Show>
            </>
          )}
        </For>
        <HomeSectionRule />
        <SectionHomeBlog />
        <HomeSectionRule />
        <div class="home-final-cta-pad">
          <SectionFinalCta
            googleButtonName="home_final_sign_up_google"
            demoButtonName="home_final_book_demo"
            mobileButtonName="home_final_get_started"
          />
        </div>
        {/* "OR KEEP EXPLORING..." feature grid hidden for now; footer kept. */}
        <div class="home-footer-pad">
          <SectionMoreFeatures currentPath="/" footerOnly />
        </div>
      </div>
    </>
  );
}
