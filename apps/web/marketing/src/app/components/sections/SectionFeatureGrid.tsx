import { A } from '@solidjs/router';
import { createSignal, For, onMount, Show } from 'solid-js';
import { isServer } from 'solid-js/web';
import taskEmailSvgUrl from '../../../assets/designs/isometric_task_email.svg?url';
import LauncherMenu from '../../../assets/designs/launcher_menu.svg';
import IconGithub from '../../../assets/icons/icon-github.svg';
import markDesyncPlaceholder from '../../../assets/mark-desync-placeholder.jpg';
import placeholderChannelsUrl from '../../../assets/placeholderchannels.webp';
import teamVideoUrl from '../../../assets/team-russell-boswell.mp4';
import { buildCalLinkWithAttribution } from '../../utils/utilAnalytic';
import { APP_BASE_URL } from '../../utils/utilBaseUrl';
import { breakpoint, viewportWidth } from '../../utils/utilBreakpoint';
import {
  CtaIcon,
  ctaHref,
  ctaLabel,
  handleCtaClick,
} from '../../utils/utilCta';
import {
  ensureGithubStars,
  formatStarCount,
  githubStars,
} from '../../utils/utilGithubStars';
import { createVisible } from '../../utils/utilVisible';
import { SharingGraphic } from '../featureGraphics/ChannelsGraphics';
import { BuildsThemselvesGraphic } from '../featureGraphics/CrmGraphics';
import {
  CollabGraphic,
  GithubStarButton,
} from '../featureGraphics/DocumentsGraphics';
import { ComposeMentionGraphic } from '../featureGraphics/EmailGraphics';
import { StatusPriorityGraphic } from '../featureGraphics/TasksGraphics';
import { SceneContextWindow } from '../scenes/SceneContextWindow';
import { SceneKeyboard } from '../scenes/SceneKeyboard';
import { SceneSignal } from '../scenes/SceneSignal';
import {
  createScrollReveal,
  RevealText,
  revealCharColor,
} from '../utils/RevealText';
import {
  AnimatedChannelIcon,
  AnimatedEmailIcon,
  AnimatedFileMdIcon,
  AnimatedTaskIcon,
} from './AnimatedComparisonIcons';
import {
  LoopsFeatureSection,
  loopsFeatureHoverStyles,
} from './LoopsFeatureSection';
import { homeFeatures } from './SectionHomeFeatures';
import { SectionMoreFeatures } from './SectionMoreFeatures';
import { SectionSecurity } from './SectionSecurity';

// Fetched as a separate cacheable asset instead of ?raw so its ~340KB don't
// sit in the entry JS chunk. will-change keeps the SVG on its own layer;
// without it WebKit re-rasterizes it whenever neighboring scenes repaint.
let taskEmailSvgPromise: Promise<string> | undefined;
function loadTaskEmailSvg(): Promise<string> {
  taskEmailSvgPromise ??= fetch(taskEmailSvgUrl)
    .then((response) => response.text())
    .then((text) =>
      text.replace(
        '<svg ',
        '<svg style="display:block;width:100%;height:auto;overflow:visible;will-change:transform" '
      )
    );
  return taskEmailSvgPromise;
}

// Prerendering has no window; bake the production URLs into the static HTML.
const isLocalhost =
  !isServer && ['localhost', '127.0.0.1'].includes(window.location.hostname);

const localDesyncVideoUrl = '/video/desync.mp4';
const productionDesyncVideoUrl = new URL(
  '/video/desync.mp4',
  APP_BASE_URL
).toString();
const desyncVideoUrl = isLocalhost
  ? localDesyncVideoUrl
  : productionDesyncVideoUrl;

const localMacroDemoVideoUrl = '/video/demo-local.mp4';
const productionMacroDemoVideoUrl = new URL(
  '/video/demo.m3u8',
  APP_BASE_URL
).toString();
const macroDemoVideoUrl = isLocalhost
  ? localMacroDemoVideoUrl
  : productionMacroDemoVideoUrl;

const comparisonItems = [
  {
    Icon: AnimatedChannelIcon,
    title: 'Quieter than Slack',
    href: '/posts/what-we-learned-from-slack',
    body: 'Designed for focused work, with AI to filter out #random pings.',
    mobileBody: 'Less pings, AI to filter out noise.',
  },
  {
    Icon: AnimatedFileMdIcon,
    title: 'Simpler than Notion',
    href: '/posts/what-we-learned-from-notion',
    body: 'Live @linked docs, native markdown: better for agents.',
    mobileBody: '@linked docs, live collab, md-native.',
  },
  {
    Icon: AnimatedEmailIcon,
    title: 'Faster than Superhuman',
    href: '/posts/what-we-learned-from-superhuman',
    body: 'Email, messages, and tasks in one keyboard-driven inbox.',
    mobileBody: 'Email, chat, and tasks in one inbox.',
  },
  {
    Icon: AnimatedTaskIcon,
    title: 'Lighter than Linear',
    href: '/posts/what-we-learned-from-linear',
    body: 'Simple. Fast. Always up-to-date. @linked to agents.',
    mobileBody: 'Fast, shortcuts, integrates with Github.',
  },
];

const manifestoItems = [
  'One app, not six tabs.',
  'Shared memory for agents.',
  'Extremely fast.',
  'Open source.',
];

const teamMembers = [
  {
    name: 'Russell Boswell',
    tags: ['designer', 'self-taught color theorist'],
  },
  {
    name: 'Aidan Holloway-Bidwell',
    tags: ['character artist', 'ex-google'],
  },
  {
    name: 'Peter Chinman',
    tags: ['park poet', 'design engineer'],
  },
];

export function MacroTextLogo() {
  return (
    <svg
      aria-label="Macro"
      role="img"
      viewBox="0 0 442 58"
      style={{
        color: 'var(--a0)',
        display: 'inline-block',
        height: '0.56em',
        'margin-right': '0.08em',
        overflow: 'visible',
        'vertical-align': '-0.55px',
        width: 'auto',
      }}
    >
      <path
        d="M375.543 0.000105085V13.1771H426.055C427.346 13.1771 428.251 14.0823 428.251 15.3732V43.9233H441.428V15.3732C441.428 6.96095 434.467 0.000105085 426.055 0.000105085H375.543ZM428.251 43.9233H377.739C376.448 43.9233 375.543 43.018 375.543 41.7271V13.1771H362.366V41.7271C362.366 50.1394 369.327 57.1002 377.739 57.1002H428.251V43.9233Z"
        fill="currentColor"
      />
      <path
        d="M287.697 0.00117743V13.1781H338.208C339.499 13.1781 340.405 14.0834 340.405 15.3743V24.1589C340.405 25.4498 339.499 26.3551 338.208 26.3551H287.697V13.1781H274.52V57.1013H287.697V39.532H328.645L337.43 57.1013H352.164L342.959 38.6913C349.074 36.6553 353.582 30.9073 353.582 24.1589V15.3743C353.582 6.96201 346.621 0.00117743 338.208 0.00117743H287.697Z"
        fill="currentColor"
      />
      <path
        d="M202.047 0.000105085C193.634 0.000105085 186.674 6.96095 186.674 15.3732V43.9233H199.823V57.096H265.735V43.919L199.85 43.9212V15.3733C199.85 14.0824 200.756 13.1771 202.047 13.1771H265.735V0.000155351L202.047 0.000105085Z"
        fill="currentColor"
      />
      <path
        d="M112.004 0.00117743V13.1781H162.516C163.807 13.1781 164.712 14.0834 164.712 15.3743V26.3551H112.004V13.1781H98.8271V57.1013H112.004V39.532H164.712V57.1013H177.889V15.3743C177.889 6.96201 170.928 0.00117743 162.516 0.00117743H112.004Z"
        fill="currentColor"
      />
      <path
        d="M13.177 0V13.177H21.4447C22.1205 13.1767 22.779 13.3903 23.326 13.7871C23.8731 14.1839 24.2806 14.7435 24.4902 15.386L38.0918 57.1001H51.9507L65.5931 15.2659C65.7908 14.6588 66.1755 14.1298 66.692 13.7546C67.2086 13.3794 67.8307 13.1772 68.4691 13.177H76.8656V57.1001H90.0425V0H58.9081C58.2697 0.000287922 57.6476 0.202507 57.1311 0.577708C56.6145 0.952909 56.2298 1.48188 56.0321 2.08894L45.0213 35.8506L34.0104 2.08894C33.8127 1.48188 33.428 0.952909 32.9115 0.577708C32.3949 0.202507 31.7729 0.000287922 31.1344 0H13.177ZM13.177 13.177H0V57.1001H13.177V13.177Z"
        fill="currentColor"
      />
    </svg>
  );
}

function _QuoteVideo() {
  const [modalOpen, setModalOpen] = createSignal(false);
  const compact = () => viewportWidth() < 700;
  const stacked = () => breakpoint();

  return (
    <div
      style={{
        'background-color': 'var(--b2)',
        display: 'grid',
        gap: '1px',
      }}
    >
      <div
        style={{
          'background-color': 'var(--b0)',
          cursor: 'pointer',
          height: compact() ? '320px' : stacked() ? '340px' : '360px',
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={() => setModalOpen(true)}
      >
        <img
          src={markDesyncPlaceholder}
          loading="lazy"
          decoding="async"
          alt="Preview frame of the Macro demo video"
          style={{
            display: 'block',
            filter: 'brightness(0.82)',
            height: '100%',
            inset: '0',
            'object-fit': 'cover',
            'object-position': 'center center',
            'pointer-events': 'none',
            position: 'absolute',
            width: '100%',
          }}
        />
        <div
          style={{
            display: 'grid',
            gap: compact() ? '10px' : '12px',
            left: compact() ? '20px' : '44px',
            'max-width': compact() ? 'min(420px, calc(100% - 40px))' : '475px',
            padding: compact() ? '16px' : '18px 22px',
            'pointer-events': 'none',
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            'z-index': 2,
          }}
        >
          <div
            style={{
              color: 'var(--a0)',
              'font-family': 'rajdhani, body',
              'font-size': compact() ? '13px' : '14px',
              'font-weight': '700',
              'letter-spacing': '0.08em',
              'line-height': 1,
              opacity: 0.8,
              'text-decoration': 'none',
              'text-transform': 'uppercase',
            }}
          >
            Founder Story
          </div>
          <blockquote
            style={{
              color: 'var(--c1)',
              'font-family': 'display',
              'font-size': compact() ? '28px' : '30px',
              'line-height': 1.12,
              margin: '0',
              'max-width': '100%',
              'min-width': '0',
              'overflow-wrap': 'break-word',
            }}
          >
            “Macro did not help us get organized. Macro<em> is why</em> we are
            organized.”
          </blockquote>
          <div
            style={{
              color: 'var(--c4)',
              'font-family': 'rajdhani, body',
              'font-size': compact() ? '13px' : '14px',
              'font-weight': '700',
              'letter-spacing': '0.08em',
              'line-height': 1,
              opacity: 0.8,
              'text-transform': 'uppercase',
            }}
          >
            — Mark Evgenev, Founder/CEO Desync
          </div>
          <div
            style={{
              'align-items': 'center',
              display: 'grid',
              gap: compact() ? '12px' : '14px',
              'grid-template-columns': 'min-content min-content 1fr',
              'margin-top': compact() ? '12px' : '16px',
              width: compact() ? 'min(320px, 100%)' : 'min(360px, 100%)',
            }}
          >
            <svg
              width={compact() ? '38' : '42'}
              height={compact() ? '38' : '42'}
              viewBox="0 0 48 48"
              aria-hidden="true"
            >
              <circle
                cx="24"
                cy="24"
                r="21"
                fill="none"
                stroke="var(--a0)"
                stroke-width="2"
              />
              <path d="M20.5 16.5 L20.5 31.5 L32.5 24 Z" fill="var(--a0)" />
            </svg>
            <div
              style={{
                color: 'var(--c1)',
                'font-family': 'rajdhani, body',
                'font-size': compact() ? '14px' : '15px',
                'font-weight': '700',
                'letter-spacing': '0.1em',
                'line-height': 1,
                'text-transform': 'uppercase',
                'white-space': 'nowrap',
              }}
            >
              Watch Desync case study
            </div>
            <div
              style={{
                'background-color': 'var(--a0)',
                height: '1px',
                'margin-top': '1px',
                opacity: 0.8,
                width: compact() ? '72px' : stacked() ? '112px' : '118px',
              }}
            />
          </div>
        </div>
        <div
          style={{
            background: breakpoint()
              ? 'linear-gradient(90deg, oklch(from var(--b0) l c h / 0.92), oklch(from var(--b0) l c h / 0.54) 44%, oklch(from var(--b0) l c h / 0.08) 76%), linear-gradient(0deg, oklch(from var(--b0) l c h / 0.56), transparent 48%)'
              : 'linear-gradient(90deg, oklch(from var(--b0) l c h / 0.9), oklch(from var(--b0) l c h / 0.56) 38%, oklch(from var(--b0) l c h / 0.08) 70%), linear-gradient(0deg, oklch(from var(--b0) l c h / 0.44), transparent 52%)',
            inset: '0',
            'pointer-events': 'none',
            position: 'absolute',
            'z-index': 1,
          }}
        />
      </div>
      <Show when={modalOpen()}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Desync case study video"
          onClick={() => setModalOpen(false)}
          style={{
            'align-items': 'center',
            background: 'oklch(from var(--b0) l c h / 0.86)',
            display: 'grid',
            inset: '0',
            'justify-items': 'center',
            padding: compact() ? '18px' : '42px',
            position: 'fixed',
            'z-index': 100,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: 'var(--b0)',
              border:
                '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
              'box-shadow': 'var(--shadow-panel-xl)',
              'box-sizing': 'border-box',
              display: 'grid',
              'max-width': '1040px',
              position: 'relative',
              width: 'min(100%, 1040px)',
            }}
          >
            <button
              type="button"
              aria-label="Close video"
              onClick={() => setModalOpen(false)}
              style={{
                background: 'var(--b1)',
                border:
                  '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
                'border-radius': '999px',
                color: 'var(--c1)',
                cursor: 'pointer',
                'font-family': 'body',
                'font-size': '18px',
                height: '34px',
                'line-height': 1,
                position: 'absolute',
                right: '12px',
                top: '12px',
                width: '34px',
                'z-index': 1,
              }}
            >
              X
            </button>
            <video
              autoplay
              controls
              playsinline
              poster={markDesyncPlaceholder}
              preload="metadata"
              src={desyncVideoUrl}
              style={{
                'aspect-ratio': '16 / 9',
                background: 'var(--b1)',
                display: 'block',
                height: 'auto',
                'max-height': 'calc(100vh - 96px)',
                'object-fit': 'contain',
                width: '100%',
              }}
            />
          </div>
        </div>
      </Show>
    </div>
  );
}

function _PlayablePreviewVideo(props: {
  src: string;
  objectPosition?: string;
}) {
  let videoRef!: HTMLVideoElement;
  const [activated, setActivated] = createSignal(false);

  function handleActivate() {
    setActivated(true);
    videoRef.muted = false;
    videoRef.loop = false;
    videoRef.controls = true;
    videoRef.play().catch(() => {
      videoRef.controls = true;
    });
  }

  return (
    <video
      ref={videoRef}
      autoplay={!activated()}
      controls={activated()}
      loop={!activated()}
      muted={!activated()}
      onClick={handleActivate}
      playsinline
      preload="metadata"
      src={props.src}
      style={{
        'aspect-ratio': viewportWidth() < 700 ? '0.84 / 1' : '1.78 / 1',
        background: 'var(--b1)',
        cursor: activated() ? 'default' : 'pointer',
        display: 'block',
        height: '100%',
        'object-fit': 'cover',
        'object-position': props.objectPosition ?? 'center top',
        width: '100%',
      }}
    />
  );
}

function _StripeDivider(props: {
  children?: any;
  borderTop?: boolean;
  borderBottom?: boolean;
}) {
  return (
    <div
      style={{
        'align-items': 'center',
        'background-color': 'var(--b0)',
        'background-image':
          'repeating-linear-gradient(315deg, var(--b2) 0, var(--b2) 1px, transparent 0, transparent 50%)',
        'background-size': '12px 12px',
        'border-bottom': props.borderBottom ? '1px solid var(--b2)' : '0',
        'border-top': props.borderTop ? '1px solid var(--b2)' : '0',
        'box-sizing': 'border-box',
        display: 'grid',
        height: '30px',
        'justify-items': 'center',
        padding: '0 18px',
      }}
    >
      {props.children}
    </div>
  );
}

function _TeamSection() {
  return (
    <section
      aria-label="Team"
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: '0',
        padding: '0',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: '0',
          'grid-template-columns': breakpoint()
            ? '1fr'
            : 'repeat(3, minmax(0, 1fr))',
        }}
      >
        <For each={teamMembers}>
          {(member) => <TeamMemberCard member={member} />}
        </For>
      </div>

      <A
        href="/jobs"
        class="hover-relaunch"
        style={{
          'align-items': 'center',
          'background-color': 'var(--c0)',
          'box-sizing': 'border-box',
          color: 'var(--b0)',
          display: 'inline-flex',
          'font-family': 'body',
          'font-size': '18px',
          'font-weight': '700',
          gap: '8px',
          height: '34px',
          'justify-content': 'center',
          'justify-self': 'stretch',
          'letter-spacing': '0.045em',
          'line-height': '1',
          overflow: 'hidden',
          padding: '0 20px',
          'text-decoration': 'none',
          'text-transform': 'uppercase',
          transition: 'color var(--transition)',
          'white-space': 'nowrap',
          width: '100%',
        }}
      >
        Jobs
      </A>
    </section>
  );
}

function TeamMemberCard(props: { member: { name: string; tags: string[] } }) {
  return (
    <article
      style={{
        'background-color': 'var(--b0)',
        display: 'block',
        margin: '0',
        overflow: 'hidden',
        padding: '0',
        position: 'relative',
      }}
    >
      <video
        autoplay
        loop
        muted
        playsinline
        preload="metadata"
        src={teamVideoUrl}
        style={{
          'aspect-ratio': '1.78 / 1',
          background: 'var(--b1)',
          display: 'block',
          'object-fit': 'cover',
          width: '100%',
        }}
      />
      <div
        style={{
          background:
            'linear-gradient(180deg, oklch(from var(--b0) l c h / 0.62), transparent 44%), linear-gradient(0deg, oklch(from var(--b0) l c h / 0.9), transparent 58%)',
          'box-sizing': 'border-box',
          display: 'grid',
          gap: viewportWidth() < 700 ? '10px' : '12px',
          inset: '0',
          padding: viewportWidth() < 700 ? '22px' : '24px',
          'place-content': 'end start',
          position: 'absolute',
        }}
      >
        <span
          style={{
            color: 'var(--a0)',
            'font-family': 'rajdhani, body',
            'font-size': breakpoint() ? '12px' : '14px',
            'font-weight': '700',
            'letter-spacing': '0.09em',
            'line-height': 1,
            'text-transform': 'uppercase',
          }}
        >
          Team
        </span>
        <h3
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size':
              viewportWidth() < 700 ? '30px' : breakpoint() ? '34px' : '30px',
            'font-weight': '430',
            'letter-spacing': '-0.02em',
            'line-height': 1.05,
            margin: '0',
          }}
        >
          {props.member.name}
        </h3>
        <div
          style={{
            display: 'flex',
            'flex-wrap': 'wrap',
            gap: '8px',
          }}
        >
          <For each={props.member.tags}>
            {(tag) => (
              <span
                style={{
                  border: '1px solid var(--b3)',
                  color: 'var(--c2)',
                  'font-family': 'rajdhani, body',
                  'font-size': '13px',
                  'font-weight': '700',
                  'letter-spacing': '0.07em',
                  'line-height': 1,
                  padding: '6px 8px 5px',
                  'text-transform': 'uppercase',
                }}
              >
                [{tag}]
              </span>
            )}
          </For>
        </div>
      </div>
    </article>
  );
}

function ComparisonCard(props: {
  Icon: any;
  title: string;
  href: string;
  body: string;
  mobileBody?: string;
  active: boolean;
  onHoverStart: () => void;
  onHoverEnd: () => void;
}) {
  return (
    <div
      onPointerEnter={props.onHoverStart}
      onPointerLeave={props.onHoverEnd}
      onFocusIn={props.onHoverStart}
      onFocusOut={props.onHoverEnd}
      style={{
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        'align-content': 'start',
        'column-gap': viewportWidth() < 700 ? '14px' : '0',
        gap: viewportWidth() < 700 ? '0 14px' : '16px',
        'grid-template-columns':
          viewportWidth() < 700 ? 'auto minmax(0, 1fr)' : '1fr',
        'min-height': breakpoint() ? 'auto' : '190px',
        padding: viewportWidth() < 700 ? '18px' : '24px 28px',
      }}
    >
      <props.Icon
        triggerAnimation={props.active}
        style={{
          color: 'var(--a0)',
          display: 'block',
          width: viewportWidth() < 700 ? '28px' : '34px',
          height: viewportWidth() < 700 ? '28px' : '34px',
        }}
      />
      <div
        style={{
          display: 'grid',
          gap: viewportWidth() < 700 ? '6px' : '16px',
          'min-width': '0',
        }}
      >
        <h3
          style={{
            'font-family': 'display',
            'font-size': viewportWidth() < 700 ? '19px' : '18px',
            'font-weight': '450',
            'line-height': 1.12,
            margin: '0',
          }}
        >
          <A
            href={props.href}
            style={{ color: 'inherit', 'text-decoration': 'none' }}
          >
            {props.title}
          </A>
        </h3>
        <p
          style={{
            color: 'var(--c4)',
            'font-size': viewportWidth() < 700 ? '15px' : '17px',
            'line-height': 1.45,
            margin: '0',
            'padding-right': viewportWidth() < 700 ? '20px' : '0',
          }}
        >
          {viewportWidth() < 700 && props.mobileBody
            ? props.mobileBody
            : props.body}
        </p>
      </div>
    </div>
  );
}

function FinalBentoCta() {
  const compact = () => viewportWidth() < 900;

  return (
    <section
      aria-label="Get started"
      style={{
        'align-items': 'center',
        'background-color': 'var(--b0)',
        'background-image':
          'repeating-linear-gradient(315deg, var(--b2) 0, var(--b2) 1px, transparent 0, transparent 50%)',
        'background-size': '12px 12px',
        'box-sizing': 'border-box',
        display: 'grid',
        'grid-area': 'final-cta',
        'justify-items': 'center',
        'min-height': compact() ? '320px' : '420px',
        overflow: 'hidden',
        padding:
          viewportWidth() < 700
            ? '42px 16px'
            : compact()
              ? '46px 22px'
              : '72px 64px',
        position: 'relative',
        width: '100%',
      }}
    >
      <style>{`
        @media (hover) {
          .final-bento-cta-button:hover {
            transform: scale(1.02);
          }
        }
      `}</style>
      <div
        style={{
          'background-color': 'var(--b0)',
          border: '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
          'border-radius': compact() ? '30px' : '38px',
          'box-shadow': 'var(--shadow-window)',
          'box-sizing': 'border-box',
          display: 'grid',
          'align-content': 'center',
          gap: viewportWidth() < 700 ? '28px' : '32px',
          'justify-items': 'center',
          'max-width': '1040px',
          'min-height': compact() ? 'auto' : '440px',
          overflow: 'hidden',
          padding:
            viewportWidth() < 700
              ? '34px 22px'
              : compact()
                ? '36px 28px'
                : '54px 64px',
          position: 'relative',
          'text-align': 'center',
          width: 'min(100%, 1040px)',
        }}
      >
        <div
          style={{
            display: 'grid',
            gap: viewportWidth() < 700 ? '24px' : '28px',
            'justify-items': 'center',
            'max-width': '640px',
            position: 'relative',
            'z-index': 1,
          }}
        >
          <h2
            style={{
              color: 'var(--c1)',
              'font-family': 'display',
              'font-size':
                viewportWidth() < 390
                  ? '36px'
                  : viewportWidth() < 700
                    ? '42px'
                    : compact()
                      ? '47px'
                      : '51px',
              'font-weight': '410',
              'letter-spacing': '-0.015em',
              'line-height': 1.08,
              margin: 0,
            }}
          >
            Let's get started.
          </h2>
          <p
            style={{
              color: 'var(--c4)',
              'font-size':
                viewportWidth() < 700 ? '17px' : compact() ? '18px' : '21px',
              'line-height': 1.45,
              margin: 0,
              'max-width': '585px',
            }}
          >
            It takes 30 seconds to connect your inbox and bring messages, docs,
            tasks, calls, and agents into shared memory.
          </p>
        </div>
        <a
          href={ctaHref()}
          class="final-bento-cta-button"
          onClick={(event) =>
            handleCtaClick(event, 'final_bento_connect_google')
          }
          style={{
            'align-items': 'center',
            'background-color': 'var(--a0)',
            'border-radius': '999px',
            'box-sizing': 'border-box',
            color: 'var(--b0)',
            cursor: 'default',
            display: 'inline-flex',
            'font-family': 'body',
            'font-size': viewportWidth() < 700 ? '15px' : '18px',
            'font-weight': '700',
            gap: viewportWidth() < 700 ? '8px' : '10px',
            height: viewportWidth() < 700 ? '40px' : '42px',
            'justify-content': 'center',
            'letter-spacing': '0.045em',
            'line-height': 1,
            'max-width': '100%',
            overflow: 'hidden',
            padding: viewportWidth() < 700 ? '0 18px' : '0 26px',
            position: 'relative',
            'text-decoration': 'none',
            'text-transform': 'uppercase',
            transition: 'transform 160ms ease',
            'white-space': 'nowrap',
            width: viewportWidth() < 700 ? '100%' : 'max-content',
            'z-index': 1,
          }}
        >
          <CtaIcon size={16} />
          {ctaLabel('Connect with Google')}
        </a>
      </div>
      <SectionMoreFeatures currentPath="/" />
    </section>
  );
}

function LauncherMenuAnimationStyles() {
  return (
    <style>{`
      /* Disable the Figma-exported drop-shadow <filter>s on the launcher
         panels: they make every repaint of this SVG cost ~30ms in WebKit,
         and the layer/pulse animations below repaint it every frame. They
         are invisible on the dark background. (Keyframe-animated filters
         like the icon glow still apply — animation styles win over this.) */
      .launcher-menu-graphic [filter] {
        filter: none;
      }

      /* Translate-only: a rotateX() here forces WebKit to re-rasterize the
         whole filtered SVG every frame (~20fps page-wide) instead of
         compositing the layer. */
      @keyframes launcherMenuFloat {
        0%, 100% { transform: translate3d(0, 0, 0); }
        50% { transform: translate3d(0, -12px, 0); }
      }

      @keyframes launcherMenuLayerBack {
        0%, 100% { transform: translate3d(0, 0, 0); opacity: 0.34; }
        50% { transform: translate3d(-10px, 6px, 0); opacity: 0.48; }
      }

      @keyframes launcherMenuLayerMid {
        0%, 100% { transform: translate3d(0, 0, 0); opacity: 0.64; }
        50% { transform: translate3d(8px, -5px, 0); opacity: 0.82; }
      }

      @keyframes launcherMenuLayerTop {
        0%, 100% { transform: translate3d(0, 0, 0); }
        50% { transform: translate3d(0, -8px, 0); }
      }

      /* Opacity-only pulses: keyframe-animating filter: drop-shadow forces
         WebKit to re-evaluate the filter on every animated path every frame
         (the source of ~36ms p95 frame spikes near this section). */
      @keyframes launcherMenuIconPulse {
        0%, 100% { opacity: 0.88; }
        42% { opacity: 1; }
      }

      @keyframes launcherMenuOrangePulse {
        0%, 100% { opacity: 0.78; }
        45% { opacity: 1; }
      }

      @keyframes launcherMenuTrace {
        0% { stroke-dashoffset: 56; opacity: 0.48; }
        45%, 70% { opacity: 1; }
        100% { stroke-dashoffset: -56; opacity: 0.48; }
      }

      @media (prefers-reduced-motion: no-preference) {
        .launcher-menu-float {
          animation: launcherMenuFloat 8s ease-in-out infinite;
          will-change: transform;
        }

        .launcher-menu-graphic > g:nth-of-type(1),
        .launcher-menu-graphic > g:nth-of-type(2),
        .launcher-menu-graphic > g:nth-of-type(3) {
          transform-box: fill-box;
          transform-origin: center;
          will-change: transform, opacity;
        }

        .launcher-menu-graphic > g:nth-of-type(1) {
          animation: launcherMenuLayerBack 7.6s ease-in-out infinite;
        }

        .launcher-menu-graphic > g:nth-of-type(2) {
          animation: launcherMenuLayerMid 7.6s ease-in-out infinite -1.2s;
        }

        .launcher-menu-graphic > g:nth-of-type(3) {
          animation: launcherMenuLayerTop 7.6s ease-in-out infinite -2.4s;
        }

        .launcher-menu-graphic g[clip-path] path[fill="#AF9A8E"],
        .launcher-menu-graphic > g > path[fill="#AF9A8E"] {
          animation: launcherMenuIconPulse 4.8s ease-in-out infinite;
        }

        .launcher-menu-graphic g[clip-path]:nth-of-type(odd) path[fill="#AF9A8E"] {
          animation-delay: -1.4s;
        }

        .launcher-menu-graphic path[fill="#FF8200"] {
          animation: launcherMenuOrangePulse 2.8s ease-in-out infinite;
        }

        .launcher-menu-graphic line[stroke="#FF8200"] {
          animation: launcherMenuTrace 3.4s ease-in-out infinite;
          stroke-dasharray: 36 20;
        }
      }

      /* While the launcher is offscreen, every animation in it is paused —
         CSS animations keep repainting the SVG even when scrolled away. */
      .launcher-paused .launcher-menu-float,
      .launcher-paused .launcher-menu-graphic *,
      .launcher-paused .launcher-menu-graphic {
        animation-play-state: paused !important;
      }
    `}</style>
  );
}

function GitHubButton(props: { mobile: boolean; showStars: boolean }) {
  return (
    <a
      href="https://github.com/macro-inc/macro"
      target="_blank"
      rel="noreferrer"
      class="hero-cta-button"
      style={{
        'align-items': 'center',
        'background-color': 'var(--b1)',
        border: '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
        'border-radius': '999px',
        'box-sizing': 'border-box',
        color: 'var(--c1)',
        cursor: 'default',
        display: 'inline-flex',
        'font-family': 'body',
        'font-size': props.mobile ? '18px' : '16px',
        'font-weight': '700',
        gap: '8px',
        height: props.mobile ? '38px' : '30px',
        'justify-content': 'center',
        'letter-spacing': '0.045em',
        'line-height': 1,
        overflow: 'hidden',
        padding: props.mobile ? '0 22px' : '0 16px',
        'text-decoration': 'none',
        'text-transform': 'uppercase',
        transition: 'transform 160ms ease',
        'white-space': 'nowrap',
        width: 'max-content',
      }}
    >
      <IconGithub
        style={{
          display: 'block',
          height: props.mobile ? '16px' : '14px',
          width: props.mobile ? '16px' : '14px',
        }}
      />
      GitHub
      <Show when={props.showStars && githubStars() !== null}>
        <span
          aria-hidden="true"
          style={{
            color: 'color-mix(in srgb, var(--c1) 30%, transparent)',
            'font-weight': '400',
          }}
        >
          |
        </span>
        <span
          style={{
            'align-items': 'center',
            display: 'inline-flex',
            gap: '4px',
          }}
        >
          <svg
            width={props.mobile ? '14' : '12'}
            height={props.mobile ? '14' : '12'}
            viewBox="0 0 256 256"
            fill="currentColor"
            aria-hidden="true"
            style={{ display: 'block' }}
          >
            <path d="M239.2,97.29a16,16,0,0,0-13.81-11L166,81.17,142.72,25.81h0a15.95,15.95,0,0,0-29.44,0L90.07,81.17,30.61,86.32a16,16,0,0,0-9.11,28.06L66.61,153.8,53.09,212.34a16,16,0,0,0,23.84,17.34l51-31,51.11,31a16,16,0,0,0,23.84-17.34l-13.51-58.6,45.1-39.36A16,16,0,0,0,239.2,97.29Z" />
          </svg>
          {formatStarCount(githubStars()!)}
        </span>
      </Show>
    </a>
  );
}

function GitGraphGraphic(props: { compact: boolean }) {
  const lineColor = 'color-mix(in srgb, var(--c4) 55%, transparent)';
  return (
    <svg
      viewBox="0 0 320 180"
      width={props.compact ? '260' : '320'}
      height={props.compact ? '146' : '180'}
      fill="none"
      aria-hidden="true"
      style={{ display: 'block', 'max-width': '100%', overflow: 'visible' }}
    >
      {/* main branch */}
      <path
        d="M30 56 H290"
        stroke={lineColor}
        stroke-width="2.5"
        stroke-linecap="round"
      />
      {/* fork down to feature branch */}
      <path
        d="M95 56 C95 102, 125 78, 125 124"
        stroke="var(--a0)"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      {/* feature branch */}
      <path
        d="M125 124 H255"
        stroke="var(--a0)"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      {/* merge back into main */}
      <path
        d="M255 124 C255 78, 290 102, 290 56"
        stroke="var(--a0)"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      {/* main branch commit nodes */}
      <circle
        cx="30"
        cy="56"
        r="8"
        fill="var(--b0)"
        stroke={lineColor}
        stroke-width="2.5"
      />
      <circle
        cx="95"
        cy="56"
        r="8"
        fill="var(--b0)"
        stroke={lineColor}
        stroke-width="2.5"
      />
      <circle
        cx="160"
        cy="56"
        r="8"
        fill="var(--b0)"
        stroke={lineColor}
        stroke-width="2.5"
      />
      <circle
        cx="225"
        cy="56"
        r="8"
        fill="var(--b0)"
        stroke={lineColor}
        stroke-width="2.5"
      />
      <circle
        cx="290"
        cy="56"
        r="9"
        fill="var(--a0)"
        stroke="var(--a0)"
        stroke-width="2.5"
      />
      {/* feature branch commit nodes */}
      <circle
        cx="125"
        cy="124"
        r="8"
        fill="var(--b0)"
        stroke="var(--a0)"
        stroke-width="2.5"
      />
      <circle
        cx="190"
        cy="124"
        r="8"
        fill="var(--b0)"
        stroke="var(--a0)"
        stroke-width="2.5"
      />
      <circle
        cx="255"
        cy="124"
        r="8"
        fill="var(--b0)"
        stroke="var(--a0)"
        stroke-width="2.5"
      />
      {/* star badge on the merge commit */}
      <svg
        x="282"
        y="20"
        width="16"
        height="16"
        viewBox="0 0 256 256"
        fill="var(--a0)"
      >
        <path d="M239.2,97.29a16,16,0,0,0-13.81-11L166,81.17,142.72,25.81h0a15.95,15.95,0,0,0-29.44,0L90.07,81.17,30.61,86.32a16,16,0,0,0-9.11,28.06L66.61,153.8,53.09,212.34a16,16,0,0,0,23.84,17.34l51-31,51.11,31a16,16,0,0,0,23.84-17.34l-13.51-58.6,45.1-39.36A16,16,0,0,0,239.2,97.29Z" />
      </svg>
    </svg>
  );
}

export function OpenSourceBento() {
  const mobile = () => viewportWidth() < 700;

  return (
    <section
      aria-label="Open source"
      style={{
        'align-items': 'center',
        'background-color': 'var(--b0)',
        'box-sizing': 'border-box',
        display: 'grid',
        gap: mobile() ? '30px' : '48px',
        'grid-area': 'open-source',
        'grid-template-columns': mobile() ? '1fr' : 'minmax(0, 1fr) auto',
        'min-height': mobile() ? 'auto' : '280px',
        overflow: 'hidden',
        padding: mobile() ? '44px 22px' : '54px 72px',
        position: 'relative',
      }}
    >
      <div
        style={{
          display: 'grid',
          gap: mobile() ? '16px' : '20px',
          'justify-items': mobile() ? 'center' : 'start',
          'text-align': mobile() ? 'center' : 'left',
        }}
      >
        <span
          style={{
            color: 'var(--a0)',
            'font-family': 'body',
            'font-size': mobile() ? '13px' : '14px',
            'font-weight': '700',
            'letter-spacing': '0.16em',
            'line-height': 1,
            'text-transform': 'uppercase',
          }}
        >
          Open Source
        </span>
        <h2
          style={{
            color: 'var(--c1)',
            'font-family': 'display',
            'font-size': mobile() ? '32px' : '38px',
            'font-weight': '410',
            'letter-spacing': '-0.015em',
            'line-height': 1.12,
            margin: 0,
            'max-width': '560px',
          }}
        >
          Built in the open.
        </h2>
        <p
          style={{
            color: 'var(--c4)',
            'font-size': mobile() ? '17px' : '20px',
            'line-height': 1.45,
            margin: 0,
            'max-width': '520px',
          }}
        >
          Read the code, file issues, and help shape where <MacroTextLogo />{' '}
          goes. Star us on GitHub.
        </p>
        <div style={{ 'margin-top': mobile() ? '4px' : '8px' }}>
          <GitHubButton mobile={mobile()} showStars={true} />
        </div>
      </div>
      <div
        aria-hidden="true"
        style={{
          display: mobile() ? 'none' : 'block',
          'justify-self': 'end',
        }}
      >
        <GitGraphGraphic compact={false} />
      </div>
    </section>
  );
}

// Eyebrow used on the bento sections lifted from the feature subpages. Unlike
// the concept-art eyebrows (plain text), these link to the block's own page and
// carry a trailing arrow to signal "see the real feature".
function FeatureEyebrowLink(props: { href: string; children: any }) {
  return (
    <A
      href={props.href}
      class="hover-relaunch"
      style={{
        'align-items': 'center',
        color: 'var(--a0)',
        display: 'inline-flex',
        'font-family': 'rajdhani, body',
        'font-size': breakpoint() ? '12px' : '16px',
        gap: '8px',
        'letter-spacing': '0.08em',
        'text-decoration': 'none',
        'text-transform': 'uppercase',
        width: 'max-content',
      }}
    >
      {props.children}
      <span aria-hidden="true" style={{ 'font-size': '1.05em' }}>
        &rarr;
      </span>
    </A>
  );
}

function BentoSpacer(props: { area: string }) {
  return (
    <div
      aria-hidden="true"
      style={{
        'background-color': 'var(--b0)',
        'grid-area': props.area,
        height: '20px',
      }}
    />
  );
}

const BENTO_GRID_AREAS_STACKED =
  '"manifesto" "context-text" "signal-graphic" "task-text" "task-graphic" "sp-2" "compare" "sp-7" "compose-text" "compose-graphic" "sp-1" "chat-text" "chat-graphic" "collab" "status-text" "status-graphic" "sp-5" "security" "sp-4" "crm-text" "crm-graphic" "launcher" "signal-text" "context-graphic" "sp-6" "keyboard-graphic" "final-cta"';

const BENTO_GRID_AREAS_STACKED_WITH_HERO =
  '"desktop-graphic" ' + BENTO_GRID_AREAS_STACKED;

const BENTO_GRID_AREAS_DESKTOP =
  '"manifesto manifesto manifesto manifesto manifesto manifesto manifesto manifesto manifesto manifesto" "signal-graphic signal-graphic signal-graphic signal-graphic signal-graphic context-text context-text context-text context-text context-text" "task-text task-text task-text task-text task-graphic task-graphic task-graphic task-graphic task-graphic task-graphic" "sp-2 sp-2 sp-2 sp-2 sp-2 sp-2 sp-2 sp-2 sp-2 sp-2" "compare compare compare compare compare compare compare compare compare compare" "sp-7 sp-7 sp-7 sp-7 sp-7 sp-7 sp-7 sp-7 sp-7 sp-7" "compose-text compose-text compose-text compose-text compose-graphic compose-graphic compose-graphic compose-graphic compose-graphic compose-graphic" "sp-1 sp-1 sp-1 sp-1 sp-1 sp-1 sp-1 sp-1 sp-1 sp-1" "chat-graphic chat-graphic chat-graphic chat-graphic chat-graphic chat-graphic chat-text chat-text chat-text chat-text" "collab collab collab collab collab collab collab collab collab collab" "status-text status-text status-text status-text status-graphic status-graphic status-graphic status-graphic status-graphic status-graphic" "sp-5 sp-5 sp-5 sp-5 sp-5 sp-5 sp-5 sp-5 sp-5 sp-5" "security security security security security security security security security security" "sp-4 sp-4 sp-4 sp-4 sp-4 sp-4 sp-4 sp-4 sp-4 sp-4" "crm-graphic crm-graphic crm-graphic crm-graphic crm-graphic crm-graphic crm-text crm-text crm-text crm-text" "launcher launcher launcher launcher launcher launcher launcher launcher launcher launcher" "context-graphic context-graphic context-graphic context-graphic context-graphic context-graphic signal-text signal-text signal-text signal-text" "sp-6 sp-6 sp-6 sp-6 sp-6 sp-6 sp-6 sp-6 sp-6 sp-6" "keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic" "final-cta final-cta final-cta final-cta final-cta final-cta final-cta final-cta final-cta final-cta"';

const BENTO_GRID_AREAS_DESKTOP_WITH_HERO =
  '"desktop-graphic desktop-graphic desktop-graphic desktop-graphic desktop-graphic desktop-graphic desktop-graphic desktop-graphic desktop-graphic desktop-graphic" ' +
  BENTO_GRID_AREAS_DESKTOP;

const BENTO_GRID_AREAS_INTRO_STACKED =
  '"manifesto" "context-text" "signal-graphic" "task-text" "task-graphic" "sp-2" "compare"';

const BENTO_GRID_AREAS_INTRO_DESKTOP =
  '"manifesto manifesto manifesto manifesto manifesto manifesto manifesto manifesto manifesto manifesto" "signal-graphic signal-graphic signal-graphic signal-graphic signal-graphic context-text context-text context-text context-text context-text" "task-text task-text task-text task-text task-graphic task-graphic task-graphic task-graphic task-graphic task-graphic" "sp-2 sp-2 sp-2 sp-2 sp-2 sp-2 sp-2 sp-2 sp-2 sp-2" "compare compare compare compare compare compare compare compare compare compare"';

const BENTO_GRID_AREAS_OUTRO_STACKED =
  '"launcher" "signal-text" "context-graphic" "sp-6" "keyboard-graphic" "security" "final-cta"';

const BENTO_GRID_AREAS_OUTRO_DESKTOP =
  '"launcher launcher launcher launcher launcher launcher launcher launcher launcher launcher" "context-graphic context-graphic context-graphic context-graphic context-graphic signal-text signal-text signal-text signal-text signal-text" "sp-6 sp-6 sp-6 sp-6 sp-6 sp-6 sp-6 sp-6 sp-6 sp-6" "keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic keyboard-graphic" "security security security security security security security security security security" "final-cta final-cta final-cta final-cta final-cta final-cta final-cta final-cta final-cta final-cta"';

const HOME_FEATURE_GRID_AREAS = [
  'feature-email',
  'feature-documents',
  'feature-tasks',
  'feature-messages',
  'feature-crm',
] as const;

function bentoStackedRow(area: string) {
  return `"${area}"`;
}

function bentoDesktopRow(area: string) {
  return `"${Array(10).fill(area).join(' ')}"`;
}

const BENTO_GRID_AREAS_BLOCKS_STACKED =
  HOME_FEATURE_GRID_AREAS.map(bentoStackedRow).join(' ');

const BENTO_GRID_AREAS_BLOCKS_DESKTOP =
  HOME_FEATURE_GRID_AREAS.map(bentoDesktopRow).join(' ');

const HOME_STACKED_AREAS = [
  'manifesto',
  'feature-email',
  'context-text',
  'signal-graphic',
  'feature-documents',
  'compare',
  'feature-tasks',
  'task-text',
  'task-graphic',
  'feature-messages',
  'signal-text',
  'context-graphic',
  'feature-crm',
  'launcher',
  'keyboard-graphic',
  'security',
  'final-cta',
] as const;

function bentoDesktopSplitRow(
  left: string,
  leftCols: number,
  right: string,
  rightCols: number
) {
  return `"${[
    ...Array(leftCols).fill(left),
    ...Array(rightCols).fill(right),
  ].join(' ')}"`;
}

const BENTO_GRID_AREAS_HOME_STACKED =
  HOME_STACKED_AREAS.map(bentoStackedRow).join(' ');

const BENTO_GRID_AREAS_HOME_DESKTOP = [
  bentoDesktopRow('manifesto'),
  bentoDesktopRow('feature-email'),
  bentoDesktopSplitRow('signal-graphic', 5, 'context-text', 5),
  bentoDesktopRow('feature-documents'),
  bentoDesktopRow('compare'),
  bentoDesktopRow('feature-tasks'),
  bentoDesktopSplitRow('task-text', 4, 'task-graphic', 6),
  bentoDesktopRow('feature-messages'),
  bentoDesktopSplitRow('context-graphic', 5, 'signal-text', 5),
  bentoDesktopRow('feature-crm'),
  bentoDesktopRow('launcher'),
  bentoDesktopRow('keyboard-graphic'),
  bentoDesktopRow('security'),
  bentoDesktopRow('final-cta'),
].join(' ');

export function SectionFeatureGrid(
  props: {
    skipHero?: boolean;
    part?: 'full' | 'intro' | 'outro' | 'home' | 'blocks';
  } = {}
) {
  ensureGithubStars();
  const stacked = () => breakpoint();
  const mobile = () => stacked();
  const narrowDesktop = () => !stacked() && viewportWidth() < 1180;
  const [activeComparisonIndex, _setActiveComparisonIndex] = createSignal(0);
  const [hoveredComparisonIndex, setHoveredComparisonIndex] = createSignal<
    number | null
  >(null);
  const [heroDemoOpen, setHeroDemoOpen] = createSignal(false);
  const [taskEmailSvg, setTaskEmailSvg] = createSignal('');
  onMount(() => {
    void loadTaskEmailSvg().then(setTaskEmailSvg);
  });
  let launcherSectionEl: HTMLDivElement | undefined;
  const launcherVisible = createVisible(() => launcherSectionEl);
  const animatedComparisonIndex = () =>
    hoveredComparisonIndex() ?? activeComparisonIndex();
  const bentoTextStyle = () =>
    ({
      'font-family': 'display',
      'font-size': stacked() ? '28px' : '30px',
      'line-height': 1.12,
      'max-width': '100%',
      'min-width': '0',
      'overflow-wrap': 'break-word',
    }) as const;
  // Mirrors eyebrowStyle() on the feature subpages so the bento sections lifted
  // from those pages keep their original look on the homepage.
  const _eyebrowStyle = () =>
    ({
      color: 'var(--a0)',
      'font-family': 'rajdhani, body',
      'font-size': stacked() ? '12px' : '16px',
      'letter-spacing': '0.08em',
      'text-transform': 'uppercase',
    }) as const;
  // Dotted backdrop used behind the imported graphics (matches stripePanelStyle
  // on the subpages).
  const stripePanel = {
    'background-color': 'var(--b0)',
    'background-image':
      'repeating-linear-gradient(315deg, var(--b2) 0, var(--b2) 1px, transparent 0, transparent 50%)',
    'background-size': '12px 12px',
  } as const;
  const abstractCell = stripePanel;

  // Comparison ticker removed: its grid section is currently flagged off
  // (display:none, no grid-area), and the interval was driving WAAPI path
  // morphs in the hidden subtree every 1.6s — including in hidden tabs.

  const manifestoHeadingText = 'One app for you, your agents, and your team.';
  const manifestoHeadingChars = manifestoHeadingText.split('');
  let manifestoHeadingEl: HTMLHeadingElement | undefined;
  const manifestoReveal = createScrollReveal(
    () => manifestoHeadingEl,
    manifestoHeadingChars.length
  );
  const part = () => props.part ?? 'full';
  const showIntro = () =>
    part() === 'intro' || part() === 'home' || part() === 'full';
  const showOutro = () =>
    part() === 'outro' || part() === 'home' || part() === 'full';
  const showBlocks = () => part() === 'blocks' || part() === 'home';
  const showTeasers = () => part() === 'full';
  const gridAreas = () => {
    if (part() === 'home') {
      return stacked()
        ? BENTO_GRID_AREAS_HOME_STACKED
        : BENTO_GRID_AREAS_HOME_DESKTOP;
    }
    if (part() === 'blocks') {
      return stacked()
        ? BENTO_GRID_AREAS_BLOCKS_STACKED
        : BENTO_GRID_AREAS_BLOCKS_DESKTOP;
    }
    if (stacked()) {
      if (part() === 'intro') return BENTO_GRID_AREAS_INTRO_STACKED;
      if (part() === 'outro') return BENTO_GRID_AREAS_OUTRO_STACKED;
      return props.skipHero
        ? BENTO_GRID_AREAS_STACKED
        : BENTO_GRID_AREAS_STACKED_WITH_HERO;
    }
    if (part() === 'intro') return BENTO_GRID_AREAS_INTRO_DESKTOP;
    if (part() === 'outro') return BENTO_GRID_AREAS_OUTRO_DESKTOP;
    return props.skipHero
      ? BENTO_GRID_AREAS_DESKTOP
      : BENTO_GRID_AREAS_DESKTOP_WITH_HERO;
  };

  return (
    <div
      lang="en"
      style={{
        'background-color': 'var(--b2)',
        'box-sizing': 'border-box',
        overflow: 'hidden',
        display: 'grid',
        'border-right': '0',
        'border-bottom': '1px solid var(--b2)',
        'border-left': '0',
        gap: '1px',
        'grid-template-columns': stacked()
          ? '1fr'
          : 'repeat(10, minmax(0, 1fr))',
        'grid-template-areas': gridAreas(),
        position: 'relative',
      }}
    >
      <div
        aria-hidden="true"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0, transparent 170px, color-mix(in srgb, var(--b2) 40%, transparent) 420px, var(--b2) 720px, var(--b2) 100%)',
          bottom: '0',
          left: '0',
          'pointer-events': 'none',
          position: 'absolute',
          top: '0',
          width: '1px',
          'z-index': 30,
        }}
      />
      <div
        aria-hidden="true"
        style={{
          background:
            'linear-gradient(to bottom, transparent 0, transparent 170px, color-mix(in srgb, var(--b2) 40%, transparent) 420px, var(--b2) 720px, var(--b2) 100%)',
          bottom: '0',
          'pointer-events': 'none',
          position: 'absolute',
          right: '0',
          top: '0',
          width: '1px',
          'z-index': 30,
        }}
      />
      <section
        style={{
          'grid-area': 'philosophy-intro',
          'background-color': 'var(--b0)',
          'background-image':
            'repeating-linear-gradient(315deg, var(--b2) 0, var(--b2) 1px, transparent 0, transparent 50%)',
          'background-size': '12px 12px',
          'box-sizing': 'border-box',
          display: 'none',
          'justify-items': 'stretch',
          'min-height': stacked() ? '260px' : '320px',
          padding: mobile()
            ? '46px 18px'
            : stacked()
              ? '58px 28px'
              : '74px 54px',
          'place-content': 'center',
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'grid',
            'justify-items': 'start',
            'max-width': 'none',
            width: '100%',
          }}
        >
          <h2
            style={{
              color: 'var(--c1)',
              'font-family': 'display',
              'font-size': mobile() ? '34px' : '44px',
              'font-weight': '410',
              'letter-spacing': '-0.015em',
              'line-height': 1.2,
              margin: 0,
              'text-align': 'left',
            }}
          >
            <MacroTextLogo /> is not just software, it&apos;s an operating
            philosophy for you to fork and modify.
          </h2>
        </div>
      </section>

      {/* Philosophy + teo-video sections are flagged off. They must stay
          unrendered (not just display:none): hidden <video autoplay> elements
          still download their full MP4s (~34MB) on every page load. */}
      {/*
      <section
        style={{
          'grid-area': 'philosophy',
          'background-color': 'var(--b2)',
          'display': 'none',
          'gap': '1px',
          'grid-template-columns': stacked() ? '1fr' : 'minmax(0, 0.82fr) minmax(0, 1.18fr)',
        }}
      >
        <div
          style={{
            'align-content': 'center',
            'background-color': 'var(--b0)',
            'box-sizing': 'border-box',
            'display': 'grid',
            'min-height': stacked() ? 'auto' : '430px',
          }}
        >
          <div
            style={{
              'display': 'grid',
              'gap': '14px',
              'padding': mobile() ? '18px' : '22px 24px 22px 44px',
            }}
          >
            <div
              style={{
                'color': 'var(--c1)',
                'font-family': 'display',
                'font-size': mobile() ? '28px' : '30px',
                'line-height': 1.12,
                'margin': 0,
                'max-width': '100%',
                'min-width': '0',
                'overflow-wrap': 'break-word',
              }}
            >
              Consider a panoptocon desk layout for collaboration + focus
            </div>
          </div>
        </div>
        <div
          style={{
            'background-color': 'var(--b0)',
            'min-height': mobile() ? '300px' : stacked() ? '420px' : '430px',
            'overflow': 'hidden',
          }}
        >
          <PlayablePreviewVideo src="/video/panopticon-desk-design.mp4" />
        </div>
      </section>

      <section
        style={{
          'grid-area': 'teo-video',
          'background-color': 'var(--b2)',
          'display': 'none',
          'gap': '1px',
          'grid-template-columns': stacked() ? '1fr' : 'minmax(0, 0.82fr) minmax(0, 1.18fr)',
        }}
      >
        <div
          style={{
            'align-content': 'center',
            'background-color': 'var(--b0)',
            'box-sizing': 'border-box',
            'display': 'grid',
            'min-height': stacked() ? 'auto' : '430px',
          }}
        >
          <div
            style={{
              'display': 'grid',
              'gap': '14px',
              'padding': mobile() ? '18px' : '22px 24px 22px 44px',
            }}
          >
            <div
              style={{
                'color': 'var(--c1)',
                'font-family': 'display',
                'font-size': mobile() ? '28px' : '30px',
                'line-height': 1.12,
                'margin': 0,
                'max-width': '100%',
                'min-width': '0',
                'overflow-wrap': 'break-word',
              }}
            >
              Don&apos;t use engineering &quot;story points&quot;, be flexible with cycle planning.
            </div>
          </div>
        </div>
        <div
          style={{
            'background-color': 'var(--b0)',
            'min-height': mobile() ? '300px' : stacked() ? '420px' : '430px',
            'overflow': 'hidden',
          }}
        >
          <PlayablePreviewVideo src="/video/teo-nys-video.mp4" />
        </div>
      </section>
      */}

      {/* Team section is intentionally flagged off until final creative/programmer content is ready.
      <div style={{ 'grid-area': 'team-divider-top' }}>
        <StripeDivider>
          <div
            style={{
              'color': 'var(--c4)',
              'font-family': 'rajdhani, body',
              'font-size': viewportWidth() < 700 ? '11px' : '13px',
              'font-weight': '700',
              'letter-spacing': '0.07em',
              'line-height': 1,
              'overflow': 'hidden',
              'text-align': 'center',
              'text-overflow': 'ellipsis',
              'text-transform': 'uppercase',
              'white-space': 'nowrap',
              'width': '100%',
            }}
          >
            Designed by a team of creative programmers and artists in NYC.
          </div>
        </StripeDivider>
      </div>

      <div style={{ 'grid-area': 'team' }}>
        <TeamSection />
      </div>

      <div style={{ 'grid-area': 'team-divider-bottom' }}>
        <StripeDivider />
      </div>
      */}

      <Show when={showOutro()}>
        <div
          style={{
            ...abstractCell,
            'grid-area': 'signal-text',
            display: 'grid',
            'align-content': 'center',
            'margin-top': mobile() ? '-1px' : '0',
            'min-height': stacked() ? 'auto' : '360px',
          }}
        >
          <div
            style={{
              padding: viewportWidth() < 700 ? '18px' : '22px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                color: 'var(--a0)',
                display: 'inline-flex',
                'font-family': 'rajdhani, body',
                'font-size': breakpoint() ? '12px' : '16px',
                gap: '7px',
                'letter-spacing': '0.08em',
                'text-decoration': 'none',
                'text-transform': 'uppercase',
              }}
            >
              Focus on what matters
            </span>
            <RevealText
              style={bentoTextStyle()}
              segments={[
                { text: 'AI separates Signal, ' },
                { text: 'like important emails and messages, ', muted: true },
                { text: 'from Noise.' },
              ]}
            />
          </div>
        </div>

        <div
          style={{
            ...abstractCell,
            'grid-area': 'context-graphic',
            'min-height': stacked() ? '236px' : '340px',
            'align-items': 'center',
            'justify-items': 'center',
            display: 'grid',
            'margin-top': mobile() ? '-1px' : '0',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: stacked() ? '92%' : '86%',
              transform: stacked()
                ? 'translateY(-8px) scale(0.82)'
                : 'translate(-8px, 18px) scale(0.94)',
              'transform-origin': 'center center',
            }}
          >
            <SceneSignal />
          </div>
        </div>

        <Show when={part() !== 'home'}>
          <BentoSpacer area="sp-6" />
        </Show>
      </Show>

      <Show when={showIntro()}>
        <div
          style={{
            ...abstractCell,
            'grid-area': 'signal-graphic',
            'min-height': stacked() ? '236px' : '290px',
            'align-items': 'center',
            'justify-items': 'center',
            display: 'grid',
            'margin-top': mobile() ? '-1px' : '0',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: '100%',
              transform: mobile()
                ? 'translate(-24px, -22px) scale(0.88)'
                : stacked()
                  ? 'translateY(-22px) scale(0.88)'
                  : 'translate(-10px, -8px) scale(0.9)',
              'transform-origin': 'center center',
            }}
          >
            <SceneContextWindow />
          </div>
        </div>

        <div
          style={{
            ...abstractCell,
            'grid-area': 'context-text',
            display: 'grid',
            'align-content': 'center',
            'margin-top': mobile() ? '-1px' : '0',
            'min-height': stacked() ? 'auto' : '160px',
          }}
        >
          <div
            style={{
              padding: viewportWidth() < 700 ? '18px' : '22px 54px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <span
              style={{
                'font-family': 'rajdhani, body',
                'font-size': breakpoint() ? '12px' : '16px',
                color: 'var(--a0)',
                'letter-spacing': '0.08em',
                'text-transform': 'uppercase',
                'text-decoration': 'none',
              }}
            >
              All In One
            </span>
            <RevealText
              style={bentoTextStyle()}
              segments={[
                {
                  text: 'Macro replaces your siloed stack with a single app. ',
                },
                {
                  text: 'Messages, docs, tasks, calls, and email all connected.',
                  muted: true,
                },
              ]}
            />
          </div>
        </div>
      </Show>

      <Show when={!props.skipHero}>
        <div
          style={{
            'grid-area': 'desktop-graphic',
            'background-color': 'var(--b0)',
            display: 'grid',
            'align-content': 'start',
            gap: mobile() ? '25px' : '27px',
            'grid-template-rows': 'auto 1fr',
            'justify-items': 'stretch',
            height: mobile()
              ? '680px'
              : stacked()
                ? '560px'
                : narrowDesktop()
                  ? '800px'
                  : '920px',
            overflow: 'hidden',
            padding: mobile()
              ? '104px 18px 0'
              : narrowDesktop()
                ? '104px 28px 0'
                : '124px 34px 0',
            position: 'relative',
          }}
        >
          <div
            style={{
              background: 'var(--b0)',
              display: 'grid',
              gap: mobile() ? '25px' : '27px',
              'justify-items': 'center',
              'justify-self': 'center',
              'padding-bottom': '0',
              position: 'relative',
              'text-align': 'center',
              transform: mobile() ? 'none' : 'translate(0, 10px)',
              width: mobile() ? 'auto' : '100%',
              'z-index': 2,
            }}
          >
            <h1
              style={{
                'font-family': 'display',
                'font-size': mobile() ? '55px' : breakpoint() ? '57px' : '53px',
                'font-weight': mobile() ? '380' : '410',
                'letter-spacing': '-0.015em',
                'line-height': 1.08,
                margin: '0',
                'text-align': 'center',
              }}
            >
              All your work in one app.
            </h1>
            <p
              style={{
                color: 'var(--c4)',
                'font-size': mobile() ? '22px' : '24px',
                'line-height': 1.45,
                margin: '0',
                'max-width': '650px',
                'text-align': 'center',
              }}
            >
              <MacroTextLogo /> unifies your work into one app with shared
              memory. Email, messages, docs, tasks, code, agents, calls, and
              CRM.
            </p>
            <style>{`
            @media (hover) {
              .hero-cta-button:hover {
                transform: scale(1.02);
              }
            }
          `}</style>
            <div
              style={{
                'align-items': 'center',
                'background-color': mobile()
                  ? 'transparent'
                  : 'color-mix(in srgb, var(--b1) 88%, var(--b0))',
                border: mobile()
                  ? 'none'
                  : '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
                'border-radius': '999px',
                'box-sizing': 'border-box',
                display: 'flex',
                'flex-direction': mobile() ? 'column' : 'row',
                'flex-wrap': 'wrap',
                gap: mobile() ? '14px' : '10px',
                'justify-content': 'center',
                'margin-top': mobile() ? '12px' : '0',
                padding: mobile() ? '0' : '10px',
                transform: mobile()
                  ? 'none'
                  : narrowDesktop()
                    ? 'scale(1.05)'
                    : 'scale(1.2)',
                'transform-origin': 'center center',
              }}
            >
              <a
                href={ctaHref()}
                class="hero-cta-button"
                onClick={(event) =>
                  handleCtaClick(event, 'hero_connect_google')
                }
                style={{
                  'align-items': 'center',
                  'background-color': 'var(--a0)',
                  'border-radius': '999px',
                  'box-sizing': 'border-box',
                  color: 'var(--b0)',
                  cursor: 'default',
                  display: 'inline-flex',
                  'font-family': 'body',
                  'font-size': mobile() ? '18px' : '16px',
                  'font-weight': '700',
                  gap: '8px',
                  height: mobile() ? '38px' : '30px',
                  'justify-content': 'center',
                  'letter-spacing': '0.045em',
                  'line-height': 1,
                  overflow: 'hidden',
                  padding: mobile() ? '0 22px' : '0 18px',
                  'text-decoration': 'none',
                  'text-transform': 'uppercase',
                  transition: 'transform 160ms ease',
                  'white-space': 'nowrap',
                  width: 'max-content',
                }}
              >
                <CtaIcon size={mobile() ? 16 : 14} />
                {ctaLabel('Connect with Google')}
              </a>
              <Show when={!mobile()}>
                <GitHubButton mobile={mobile()} showStars={false} />
              </Show>
            </div>
            <a
              href={buildCalLinkWithAttribution(
                'https://cal.com/team/macro/macro-demo-call'
              )}
              target="_blank"
              rel="noopener noreferrer"
              class="hover-color"
              style={{
                color: 'var(--c1)',
                'font-family': 'body',
                'font-size': mobile() ? '16px' : '14px',
                'font-weight': '700',
                'line-height': 1.4,
                padding: '8px 12px',
                'text-underline-offset': '4px',
              }}
            >
              Book Demo
            </a>
          </div>
          <div
            style={{
              'align-self': mobile()
                ? 'start'
                : narrowDesktop()
                  ? 'start'
                  : 'end',
              'background-color':
                'color-mix(in srgb, var(--b1) 58%, var(--b0))',
              border:
                '1px solid color-mix(in srgb, var(--c4) 16%, transparent)',
              'border-radius': '12px',
              'box-shadow': 'var(--shadow-window)',
              'box-sizing': 'border-box',
              'justify-self': 'center',
              '-webkit-mask-image':
                'linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 58%, rgb(0 0 0 / 0.28) 100%)',
              'mask-image':
                'linear-gradient(to bottom, rgb(0 0 0 / 1) 0%, rgb(0 0 0 / 1) 58%, rgb(0 0 0 / 0.28) 100%)',
              overflow: 'hidden',
              padding: '7px',
              position: 'relative',
              width: mobile()
                ? '132%'
                : stacked()
                  ? '108%'
                  : narrowDesktop()
                    ? 'min(100%, 820px)'
                    : 'min(100%, 1040px)',
              'max-width': mobile()
                ? 'none'
                : narrowDesktop()
                  ? '820px'
                  : '1120px',
              transform: mobile()
                ? 'translateY(8px)'
                : stacked()
                  ? 'translateY(-18px)'
                  : narrowDesktop()
                    ? 'translateY(-13px)'
                    : 'translateY(49px)',
              'transform-origin': 'center center',
            }}
          >
            <img
              src={placeholderChannelsUrl}
              loading="eager"
              fetchpriority="high"
              decoding="async"
              alt="Macro app channels interface"
              style={{
                border:
                  '1px solid color-mix(in srgb, var(--c4) 12%, transparent)',
                'border-radius': '12px',
                display: 'block',
                height: 'auto',
                'object-fit': 'cover',
                'object-position': 'center top',
                width: '100%',
              }}
            />
            <button
              type="button"
              aria-label="Watch demo video"
              onClick={() => setHeroDemoOpen(true)}
              style={{
                'align-items': 'center',
                background: 'transparent',
                border: '0',
                filter: 'drop-shadow(0 10px 22px rgb(0 0 0 / 0.72))',
                color: 'var(--c1)',
                cursor: 'pointer',
                display: 'grid',
                'font-family': 'rajdhani, body',
                'font-size': viewportWidth() < 700 ? '13px' : '15px',
                'font-weight': '700',
                gap: '8px',
                'justify-items': 'center',
                left: '50%',
                'letter-spacing': '0.1em',
                'line-height': 1,
                padding: '0',
                position: 'absolute',
                'text-shadow': '0 3px 14px rgb(0 0 0 / 0.86)',
                'text-transform': 'uppercase',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                'z-index': 2,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  'align-items': 'center',
                  'background-color':
                    'color-mix(in srgb, var(--b1) 88%, var(--b0))',
                  border:
                    '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
                  'border-radius': '999px',
                  'box-shadow':
                    '0 28px 110px rgb(0 0 0 / 0.88), 0 0 42px rgb(0 0 0 / 0.58)',
                  'box-sizing': 'border-box',
                  display: 'inline-grid',
                  height: viewportWidth() < 700 ? '69px' : '78px',
                  'justify-items': 'center',
                  'place-items': 'center',
                  width: viewportWidth() < 700 ? '69px' : '78px',
                }}
              >
                <span
                  style={{
                    'border-bottom':
                      viewportWidth() < 700
                        ? '12px solid transparent'
                        : '14px solid transparent',
                    'border-left':
                      viewportWidth() < 700
                        ? '18px solid var(--a0)'
                        : '21px solid var(--a0)',
                    'border-top':
                      viewportWidth() < 700
                        ? '12px solid transparent'
                        : '14px solid transparent',
                    display: 'block',
                    height: '0',
                    'margin-left': viewportWidth() < 700 ? '5px' : '6px',
                    width: '0',
                  }}
                />
              </span>
              <span
                style={{
                  'background-color':
                    'color-mix(in srgb, var(--b1) 88%, var(--b0))',
                  border:
                    '1px solid color-mix(in srgb, var(--b4) 28%, transparent)',
                  'border-radius': '999px',
                  'box-shadow':
                    '0 24px 90px rgb(0 0 0 / 0.78), 0 0 34px rgb(0 0 0 / 0.5)',
                  'box-sizing': 'border-box',
                  display: 'inline-flex',
                  height: viewportWidth() < 700 ? '32px' : '36px',
                  'align-items': 'center',
                  padding: viewportWidth() < 700 ? '0 15px' : '0 18px',
                  'white-space': 'nowrap',
                }}
              >
                Watch demo video
              </span>
            </button>
          </div>
          <Show when={heroDemoOpen()}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Macro demo video"
              onClick={() => setHeroDemoOpen(false)}
              style={{
                'align-items': 'center',
                background: 'oklch(from var(--b0) l c h / 0.86)',
                display: 'grid',
                inset: '0',
                'justify-items': 'center',
                padding: viewportWidth() < 700 ? '18px' : '42px',
                position: 'fixed',
                'z-index': 100,
              }}
            >
              <div
                onClick={(event) => event.stopPropagation()}
                style={{
                  background: 'var(--b0)',
                  border:
                    '1px solid color-mix(in srgb, var(--c4) 18%, transparent)',
                  'border-radius': '12px',
                  'box-shadow': 'var(--shadow-panel-xl)',
                  'box-sizing': 'border-box',
                  display: 'grid',
                  'max-width': '1040px',
                  overflow: 'hidden',
                  position: 'relative',
                  width: 'min(100%, 1040px)',
                }}
              >
                <button
                  type="button"
                  aria-label="Close video"
                  onClick={() => setHeroDemoOpen(false)}
                  style={{
                    background: 'var(--b1)',
                    border:
                      '1px solid color-mix(in srgb, var(--c4) 22%, transparent)',
                    'border-radius': '999px',
                    color: 'var(--c1)',
                    cursor: 'pointer',
                    'font-family': 'body',
                    'font-size': '18px',
                    height: '34px',
                    'line-height': 1,
                    position: 'absolute',
                    right: '12px',
                    top: '12px',
                    width: '34px',
                    'z-index': 1,
                  }}
                >
                  X
                </button>
                <video
                  autoplay
                  controls
                  playsinline
                  poster={placeholderChannelsUrl}
                  preload="metadata"
                  src={macroDemoVideoUrl}
                  style={{
                    'aspect-ratio': '16 / 9',
                    background: 'var(--b1)',
                    display: 'block',
                    height: 'auto',
                    'max-height': 'calc(100vh - 96px)',
                    'object-fit': 'contain',
                    width: '100%',
                  }}
                />
              </div>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={showIntro()}>
        <section
          aria-label="Manifesto"
          style={{
            'grid-area': 'manifesto',
            'background-color': 'var(--b0)',
            'background-image':
              'repeating-linear-gradient(315deg, var(--b2) 0, var(--b2) 1px, transparent 0, transparent 50%)',
            'background-size': '12px 12px',
            'box-sizing': 'border-box',
            display: 'grid',
            'grid-template-columns': stacked()
              ? '1fr'
              : 'minmax(0, 0.92fr) minmax(360px, 0.68fr)',
            gap: stacked() ? '34px' : '64px',
            'min-height': stacked() ? 'auto' : '390px',
            padding: mobile()
              ? '44px 22px'
              : stacked()
                ? '56px 34px'
                : '72px 88px',
            position: 'relative',
          }}
        >
          <div
            style={{
              'align-self': 'center',
              display: 'grid',
              gap: '0',
              'max-width': '760px',
            }}
          >
            <h2
              ref={manifestoHeadingEl}
              style={{
                color: 'var(--c1)',
                'font-family': 'display',
                'font-size': narrowDesktop()
                  ? '30px'
                  : stacked()
                    ? '28px'
                    : '51px',
                'font-weight': '410',
                'letter-spacing':
                  narrowDesktop() || stacked() ? 'normal' : '-0.015em',
                'line-height': narrowDesktop() || stacked() ? 1.12 : 1.08,
                margin: 0,
                'max-width': narrowDesktop() || stacked() ? '100%' : '660px',
                'min-width': '0',
                'overflow-wrap': 'break-word',
              }}
            >
              {/* Prerendered HTML keeps the text whole (per-character spans
                fragment it for crawlers); the reveal only runs client-side. */}
              {isServer ? (
                <span style={{ color: 'var(--c1)' }}>
                  {manifestoHeadingText}
                </span>
              ) : (
                <For each={manifestoHeadingChars}>
                  {(char, index) => (
                    <span
                      style={{
                        color: revealCharColor(
                          manifestoReveal(),
                          index(),
                          manifestoHeadingChars.length
                        ),
                      }}
                    >
                      {char}
                    </span>
                  )}
                </For>
              )}
            </h2>
          </div>
          <div
            style={{
              'align-self': 'center',
              'background-color':
                'color-mix(in srgb, var(--b1) 70%, var(--b0))',
              border:
                '1px solid color-mix(in srgb, var(--b4) 22%, transparent)',
              'border-radius': '28px',
              'box-shadow':
                'inset 0 1px 0 color-mix(in srgb, var(--c1) 8%, transparent)',
              'box-sizing': 'border-box',
              display: 'grid',
              gap: '1px',
              overflow: 'hidden',
            }}
          >
            <For each={manifestoItems}>
              {(item, index) => (
                <div
                  style={{
                    'align-items': 'center',
                    'background-color': 'var(--b0)',
                    'box-sizing': 'border-box',
                    color: 'var(--c1)',
                    display: 'grid',
                    'font-family': 'display',
                    'font-size': mobile() ? '22px' : '24px',
                    'font-weight': '410',
                    'grid-template-columns': 'auto minmax(0, 1fr)',
                    gap: '14px',
                    'line-height': 1.12,
                    padding: mobile() ? '18px' : '22px 24px',
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      color: 'var(--a0)',
                      'font-family': 'rajdhani, body',
                      'font-size': '14px',
                      'font-weight': '700',
                      'letter-spacing': '0.08em',
                      'line-height': 1,
                    }}
                  >
                    0{index() + 1}
                  </span>
                  <span
                    style={{
                      color: 'var(--c4)',
                      'font-family': 'body',
                      'font-size': mobile() ? '19px' : '22px',
                      'font-weight': '400',
                      'line-height': 1.38,
                      margin: 0,
                      'max-width': '660px',
                    }}
                  >
                    {item}
                  </span>
                </div>
              )}
            </For>
          </div>
        </section>

        {/* Unified Inbox */}
        <div
          style={{
            ...abstractCell,
            'grid-area': 'task-text',
            display: 'grid',
            'align-content': 'center',
            'min-height': stacked() ? 'auto' : '220px',
          }}
        >
          <div
            style={{
              padding:
                viewportWidth() < 700
                  ? '18px 18px 18px 38px'
                  : stacked()
                    ? '22px 24px 22px 64px'
                    : '22px 24px 22px 84px',
              display: 'grid',
              gap: '14px',
            }}
          >
            <span
              style={{
                'align-items': 'center',
                color: 'var(--a0)',
                display: 'inline-flex',
                'font-family': 'rajdhani, body',
                'font-size': breakpoint() ? '12px' : '16px',
                gap: '7px',
                'letter-spacing': '0.08em',
                'text-decoration': 'none',
                'text-transform': 'uppercase',
              }}
            >
              Unified Inbox
            </span>
            <RevealText
              style={bentoTextStyle()}
              segments={[
                {
                  text: 'One inbox for everything.',
                  style: { 'white-space': 'nowrap' },
                },
                {
                  text: ' Triage all your email accounts, messages, and tasks in one place.',
                  muted: true,
                },
              ]}
            />
          </div>
        </div>

        <div
          style={{
            ...abstractCell,
            'grid-area': 'task-graphic',
            display: 'grid',
            'align-items': 'center',
            'justify-items': 'center',
            'margin-left': stacked() ? '0' : '-1px',
            'margin-top': mobile() ? '-1px' : '0',
            'min-height': mobile() ? '340px' : stacked() ? '250px' : '220px',
            overflow: 'hidden',
            padding: mobile()
              ? '0 18px 16px'
              : viewportWidth() < 700
                ? '8px 18px 20px'
                : '12px 24px',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              'min-height': mobile() ? '324px' : stacked() ? '220px' : '520px',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              innerHTML={taskEmailSvg()}
              style={{
                display: 'block',
                position: mobile()
                  ? 'absolute'
                  : stacked()
                    ? 'static'
                    : 'absolute',
                left: mobile()
                  ? '58%'
                  : stacked()
                    ? 'auto'
                    : 'calc(50% + 20px)',
                top: mobile() ? '52%' : '50%',
                width: mobile() ? '430px' : stacked() ? '560px' : '640px',
                height: 'auto',
                transform: mobile()
                  ? 'translate(-50%, -50%)'
                  : stacked()
                    ? 'none'
                    : 'translate(-50%, -50%)',
                'transform-origin': 'center center',
              }}
            />
          </div>
        </div>

        <Show when={part() !== 'home'}>
          <BentoSpacer area="sp-2" />
        </Show>

        {/* "vs the tools you know" — re-uses the comparison copy so a new
          visitor can anchor Macro against products they already understand. */}
        <section
          aria-label="How Macro compares"
          style={{
            ...abstractCell,
            'grid-area': 'compare',
            display: 'grid',
            gap: '1px',
          }}
        >
          <div
            style={{
              'background-color': 'var(--b2)',
              display: 'grid',
              gap: '1px',
              'grid-template-columns': stacked()
                ? '1fr'
                : 'repeat(4, minmax(0, 1fr))',
            }}
          >
            <For each={comparisonItems}>
              {(item, index) => (
                <ComparisonCard
                  Icon={item.Icon}
                  title={item.title}
                  href={item.href}
                  body={item.body}
                  mobileBody={item.mobileBody}
                  active={animatedComparisonIndex() === index()}
                  onHoverStart={() => setHoveredComparisonIndex(index())}
                  onHoverEnd={() =>
                    setHoveredComparisonIndex((currentIndex) =>
                      currentIndex === index() ? null : currentIndex
                    )
                  }
                />
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={showBlocks()}>
        <style>{loopsFeatureHoverStyles()}</style>
        <For each={homeFeatures}>
          {(block, index) => (
            <div
              style={{
                'background-color': 'var(--b0)',
                'box-sizing': 'border-box',
                display: 'grid',
                'grid-area': HOME_FEATURE_GRID_AREAS[index()],
                padding: mobile()
                  ? '36px 18px 40px'
                  : narrowDesktop()
                    ? '48px 28px 44px'
                    : '56px 34px 48px',
              }}
            >
              <LoopsFeatureSection block={block} textLayout="split" />
            </div>
          )}
        </For>
      </Show>

      <Show when={showTeasers()}>
        <BentoSpacer area="sp-7" />

        {/* AI email client — compose + @mention (from /email) */}
        <div
          style={{
            'align-content': 'center',
            'background-color': 'var(--b0)',
            display: 'grid',
            'grid-area': 'compose-text',
            'min-height': stacked() ? 'auto' : '460px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: '14px',
              padding: mobile() ? '28px 18px 4px' : '22px 24px 22px 44px',
            }}
          >
            <FeatureEyebrowLink href="/email">Email</FeatureEyebrowLink>
            <RevealText
              style={bentoTextStyle()}
              segments={[
                { text: '@mention from your workspace. ' },
                {
                  text: "People are cc'd and files are attachments.",
                  muted: true,
                },
              ]}
            />
          </div>
        </div>
        <div
          style={{
            ...stripePanel,
            'align-items': 'center',
            display: 'grid',
            'grid-area': 'compose-graphic',
            'justify-items': 'center',
            'margin-top': mobile() ? '-1px' : '0',
            'min-height': stacked() ? 'auto' : '460px',
            overflow: 'hidden',
          }}
        >
          <ComposeMentionGraphic />
        </div>

        <BentoSpacer area="sp-1" />
      </Show>

      <Show when={showOutro()}>
        <div
          ref={launcherSectionEl}
          classList={{ 'launcher-paused': !launcherVisible() }}
          style={{
            ...abstractCell,
            'grid-area': 'launcher',
            display: 'grid',
            position: 'relative',
            'align-items': 'center',
            'justify-items': 'center',
            'min-height': stacked() ? 'auto' : '420px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              'align-content': stacked() ? 'center' : 'start',
              'justify-self': stacked() ? 'stretch' : 'start',
              position: stacked() ? 'relative' : 'absolute',
              top: stacked() ? 'auto' : '64px',
              left: stacked() ? 'auto' : '88px',
              'z-index': 1,
              width: stacked() ? 'auto' : 'min(460px, 48%)',
              padding:
                viewportWidth() < 700 ? '18px' : stacked() ? '22px 24px' : '0',
              gap: '14px',
            }}
          >
            <span
              style={{
                'font-family': 'rajdhani, body',
                'font-size': breakpoint() ? '12px' : '16px',
                color: 'var(--a0)',
                'letter-spacing': '0.08em',
                'text-transform': 'uppercase',
                'text-decoration': 'none',
              }}
            >
              Team-Level Memory
            </span>
            <RevealText
              style={bentoTextStyle()}
              segments={[
                { text: 'Everything your team does is stored in one place ' },
                { text: 'so agents have full context.', muted: true },
              ]}
            />
          </div>
          <LauncherMenuAnimationStyles />
          <div
            class="launcher-menu-float"
            style={{
              display: 'grid',
              'align-items': 'start',
              'justify-items': 'center',
              width: '100%',
              'min-height': stacked() ? '260px' : '420px',
              overflow: 'hidden',
              padding: viewportWidth() < 700 ? '8px 18px 20px' : '0 24px 38px',
            }}
          >
            <LauncherMenu
              class="launcher-menu-graphic"
              style={{
                display: 'block',
                width: stacked() ? '520px' : '780px',
                'max-width': 'none',
                height: 'auto',
                overflow: 'visible',
                transform: mobile()
                  ? 'translate(-18px, -6px) scale(0.88)'
                  : stacked()
                    ? 'translateY(-6px) scale(0.88)'
                    : 'translate(36px, 58px) scale(0.94)',
                'transform-origin': 'center center',
              }}
            />
          </div>
        </div>

        <div
          style={{
            ...abstractCell,
            'grid-area': 'keyboard-graphic',
            display: 'grid',
            'align-content': stacked() ? 'start' : 'stretch',
            'align-items': stacked() ? 'center' : 'stretch',
            'justify-items': 'center',
            'min-height': stacked() ? '320px' : '510px',
            overflow: 'hidden',
            padding: viewportWidth() < 700 ? '0 18px 18px' : '0 34px',
            position: 'relative',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: mobile() ? '16px' : '18px',
              'justify-items': mobile() || stacked() ? 'center' : 'start',
              'max-width': mobile() || stacked() ? '520px' : '420px',
              padding: mobile() || stacked() ? '44px 22px 0' : '24px 0 0',
              position: mobile() || stacked() ? 'relative' : 'absolute',
              left: mobile() || stacked() ? undefined : '108px',
              'text-align': mobile() || stacked() ? 'center' : 'left',
              top: mobile() || stacked() ? undefined : '48px',
              'z-index': 2,
            }}
          >
            <RevealText
              style={bentoTextStyle()}
              segments={[
                { text: "It's all open source. " },
                {
                  text: 'Modular, extensible, and fully owned by the community.',
                  muted: true,
                },
              ]}
            />
            <GitHubButton mobile={mobile()} showStars={true} />
          </div>
          <div
            style={{
              width: stacked() ? '118%' : '100%',
              'max-width': '1040px',
              transform: stacked() ? 'translateY(-18px)' : 'translateY(80px)',
              'transform-origin': 'center center',
            }}
          >
            <SceneKeyboard />
          </div>
        </div>

        {/* Caret-blink keyframes for the graphics lifted from the subpages
          (their own <style> blocks only render on those routes). */}
        <style>{`
        @media (hover) {
          .docs-cta-button:hover { transform: scale(1.02); }
        }
        @media (prefers-reduced-motion: no-preference) {
          @keyframes docsCollabBlink { 0%, 55% { opacity: 1; } 56%, 100% { opacity: 0.25; } }
          .docs-collab-caret { animation: docsCollabBlink 1s steps(1) infinite; }
        }
      `}</style>

        <Show when={showTeasers()}>
          {/* Real-time documents — collaborative editor (from /documents) */}
          <section
            aria-label="Real-time collaboration"
            style={{
              'background-color': 'var(--b0)',
              'box-sizing': 'border-box',
              display: 'grid',
              gap: mobile() ? '24px' : '40px',
              'grid-area': 'collab',
              'justify-items': 'center',
              padding: mobile() ? '44px 18px 50px' : '64px 34px 54px',
            }}
          >
            <div
              style={{
                display: 'grid',
                gap: '14px',
                'justify-items': 'center',
                'max-width': '720px',
                'text-align': 'center',
              }}
            >
              <FeatureEyebrowLink href="/documents">
                Documents
              </FeatureEyebrowLink>
              <RevealText
                style={{ ...bentoTextStyle(), 'text-align': 'center' }}
                segments={[
                  {
                    text: "Edits instantly like you're on the same computer.",
                  },
                ]}
              />
            </div>
            <CollabGraphic />
            <div
              style={{
                display: 'grid',
                gap: mobile() ? '20px' : '24px',
                'justify-items': 'center',
                'max-width': '400px',
              }}
            >
              <p
                style={{
                  color: 'var(--c4)',
                  'font-family': 'rajdhani, body',
                  'font-size': breakpoint() ? '14px' : '16px',
                  'font-weight': '400',
                  'letter-spacing': '0.04em',
                  'line-height': 1.45,
                  margin: '0',
                  'text-align': 'center',
                }}
              >
                Markdown docs built for human-agent collaboration. Built with
                CRDTs for offline editing.
              </p>
              <GithubStarButton />
            </div>
          </section>

          <BentoSpacer area="sp-5" />
        </Show>

        <SectionSecurity gridArea="security" />
      </Show>

      <Show when={showTeasers()}>
        {/* Tasks — status & priority (from /tasks) */}
        <div
          style={{
            ...stripePanel,
            'align-items': 'center',
            display: 'grid',
            'grid-area': 'status-graphic',
            'justify-items': 'center',
            'min-height': stacked() ? 'auto' : '460px',
            overflow: 'hidden',
          }}
        >
          <StatusPriorityGraphic />
        </div>

        <div
          style={{
            'align-content': 'center',
            'background-color': 'var(--b0)',
            display: 'grid',
            'grid-area': 'status-text',
            'margin-top': mobile() ? '-1px' : '0',
            'min-height': stacked() ? 'auto' : '460px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: '16px',
              padding: mobile() ? '28px 18px 4px' : '22px 44px 22px 54px',
            }}
          >
            <FeatureEyebrowLink href="/tasks">Tasks</FeatureEyebrowLink>
            <RevealText
              style={bentoTextStyle()}
              segments={[
                {
                  text: 'Tasks stay up to date automatically.',
                },
                {
                  text: " Deep @linked to Github PR's and your workspace.",
                  muted: true,
                },
              ]}
            />
          </div>
        </div>

        <BentoSpacer area="sp-4" />

        {/* Messages — channel sharing (from /channels) */}
        <div
          style={{
            ...stripePanel,
            'align-items': 'center',
            display: 'grid',
            'grid-area': 'chat-graphic',
            'justify-items': 'center',
            'min-height': stacked() ? 'auto' : '460px',
            overflow: 'hidden',
          }}
        >
          <SharingGraphic />
        </div>
        <div
          style={{
            'align-content': 'center',
            'background-color': 'var(--b0)',
            display: 'grid',
            'grid-area': 'chat-text',
            'margin-top': mobile() ? '-1px' : '0',
            'min-height': stacked() ? 'auto' : '460px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: '14px',
              padding: mobile() ? '28px 18px 4px' : '22px 44px 22px 54px',
            }}
          >
            <FeatureEyebrowLink href="/channels">Messages</FeatureEyebrowLink>
            <RevealText
              style={bentoTextStyle()}
              segments={[
                { text: 'Channels linked to your whole workspace. ' },
                {
                  text: 'Everything you @link is shared with the channel.',
                  muted: true,
                },
              ]}
            />
          </div>
        </div>

        {/* CRM — builds itself (from /crm) */}
        <div
          style={{
            'align-content': 'center',
            'background-color': 'var(--b0)',
            display: 'grid',
            'grid-area': 'crm-text',
            'min-height': stacked() ? 'auto' : '460px',
          }}
        >
          <div
            style={{
              display: 'grid',
              gap: '14px',
              padding: mobile() ? '28px 18px 4px' : '22px 44px 22px 54px',
            }}
          >
            <FeatureEyebrowLink href="/crm">CRM</FeatureEyebrowLink>
            <RevealText
              style={bentoTextStyle()}
              segments={[
                { text: 'A CRM that builds itself. ' },
                {
                  text: 'Contacts and deals update from your email and calls.',
                  muted: true,
                },
              ]}
            />
          </div>
        </div>
        <div
          style={{
            ...stripePanel,
            'align-items': 'center',
            display: 'grid',
            'grid-area': 'crm-graphic',
            'justify-items': 'center',
            'margin-top': mobile() ? '-1px' : '0',
            'min-height': stacked() ? 'auto' : '460px',
            overflow: 'hidden',
          }}
        >
          <BuildsThemselvesGraphic />
        </div>
      </Show>

      <Show when={showOutro()}>
        <FinalBentoCta />
      </Show>
    </div>
  );
}
