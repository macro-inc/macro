import AppStoreQr from '@assets/mobile-qr/app-store.svg';
import PlayStoreQr from '@assets/mobile-qr/play-store.svg';
import MacroLogo from '@icon/macro-logo.svg';
import ArrowUpRight from '@phosphor/arrow-up-right.svg';
import { Tabs } from '@ui/components/Tabs';
import { createSignal, For, type JSX, onMount, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { FeaturePage } from '../../features/marketing/components/FeaturePage';
import {
  DESKTOP_DOWNLOAD_URLS,
  DESKTOP_PLATFORM_DETAILS,
  DESKTOP_PLATFORMS,
  DESKTOP_RELEASE_URL,
  type DesktopPlatform,
  detectPhonePlatform,
  detectVisitorPlatform,
  installerPlatform,
  PHONE_PLATFORM_DETAILS,
  PHONE_PLATFORMS,
  type PhonePlatform,
  phonePlatformOrder,
  type VisitorPlatform,
} from '../../features/marketing/core/desktopDownloads';
import { analytics } from '../utils/utilAnalytic';
import { setPageSeo } from '../utils/utilSeo';
import './RouteDownload.css';

// The same QR artwork as the app's Settings → Downloads page
// (apps/web/src/lib/design), copied because the two apps share no package.
const STORE_QR_CODES = { ios: AppStoreQr, android: PlayStoreQr };

const STORE_TABS = PHONE_PLATFORMS.map((platform) => ({
  value: platform,
  label: PHONE_PLATFORM_DETAILS[platform].device,
}));

export function RouteDownload() {
  setPageSeo({
    title: 'Download Macro Alpha',
    description: 'Download the Macro alpha desktop app for macOS and Linux.',
    path: '/download',
  });

  const [visitor, setVisitor] = createSignal<VisitorPlatform>();
  const [phone, setPhone] = createSignal<PhonePlatform>();

  onMount(() => {
    setVisitor(detectVisitorPlatform(navigator.userAgent));
    setPhone(detectPhonePlatform(navigator.userAgent));
  });

  return (
    <FeaturePage>
      <div class="downloads-page">
        <header class="downloads-header">
          <div class="downloads-app-icon" aria-hidden="true">
            <MacroLogo />
          </div>
          {/* Phones get the mobile apps, never the desktop installers. */}
          <h1>
            Download Macro
            <span class="downloads-desktop-only"> Alpha</span>
          </h1>
          <p class="downloads-desktop-only">Available for macOS and Linux</p>
          <p class="downloads-phone-only">Get Macro on your phone.</p>
        </header>

        <ul
          class="downloads-installers downloads-phone-only"
          aria-label="Mobile apps"
        >
          <For each={phonePlatformOrder(phone())}>
            {(platform, index) => (
              <li>
                <a
                  class={index() === 0 ? 'site-nav-start' : 'site-nav-demo'}
                  href={PHONE_PLATFORM_DETAILS[platform].url}
                >
                  Download for {PHONE_PLATFORM_DETAILS[platform].label}
                </a>
                <span>{PHONE_PLATFORM_DETAILS[platform].store}</span>
              </li>
            )}
          </For>
        </ul>

        <div class="downloads-action downloads-desktop-only">
          <Show
            when={installerPlatform(visitor())}
            fallback={<AnyInstaller visitor={visitor()} />}
          >
            {(platform) => <VisitorInstaller platform={platform()} />}
          </Show>
        </div>

        <p class="downloads-release downloads-desktop-only">
          <a href={DESKTOP_RELEASE_URL} target="_blank" rel="noreferrer">
            All releases
            <ArrowUpRight aria-hidden="true" />
          </a>
        </p>

        <MobileQrCodes initial={phone()} />
      </div>
    </FeaturePage>
  );
}

/** A tracked link to a platform's installer. */
function InstallerLink(props: {
  platform: DesktopPlatform;
  class?: string;
  'aria-label'?: string;
  children: JSX.Element;
}) {
  return (
    <a
      class={props.class}
      href={DESKTOP_DOWNLOAD_URLS[props.platform]}
      aria-label={props['aria-label']}
      // A full request, so the edge redirect serves the installer.
      target="_self"
      onClick={() =>
        analytics.trackPosthog('desktop_download_clicked', {
          platform: props.platform,
          source: 'marketing',
        })
      }
    >
      {props.children}
    </a>
  );
}

/**
 * The installer for the visitor's computer, with the other platforms as quiet
 * links so they stay reachable.
 */
function VisitorInstaller(props: { platform: DesktopPlatform }) {
  const others = () =>
    DESKTOP_PLATFORMS.filter((platform) => platform !== props.platform);

  return (
    <>
      <ul class="downloads-installers" aria-label="Desktop installers">
        <li>
          <InstallerLink platform={props.platform} class="site-nav-start">
            Download for {DESKTOP_PLATFORM_DETAILS[props.platform].label}
          </InstallerLink>
          <span>{DESKTOP_PLATFORM_DETAILS[props.platform].requirement}</span>
        </li>
      </ul>
      <p class="downloads-alternatives">
        Also available for{' '}
        <For each={others()}>
          {(platform, index) => (
            <>
              <Show when={index() > 0}> · </Show>
              <InstallerLink
                platform={platform}
                aria-label={`Download for ${DESKTOP_PLATFORM_DETAILS[platform].label}`}
              >
                {DESKTOP_PLATFORM_DETAILS[platform].label}
              </InstallerLink>
            </>
          )}
        </For>
      </p>
    </>
  );
}

/**
 * Every installer as an equal choice, for a computer Macro has no installer
 * for (Windows, ChromeOS) or one it can't detect, with the web app as the way
 * to use Macro there.
 */
function AnyInstaller(props: { visitor: VisitorPlatform | undefined }) {
  return (
    <>
      <ul class="downloads-installers" aria-label="Desktop installers">
        <For each={DESKTOP_PLATFORMS}>
          {(platform) => (
            <li>
              <InstallerLink platform={platform} class="site-nav-demo">
                Download for {DESKTOP_PLATFORM_DETAILS[platform].label}
              </InstallerLink>
              <span>{DESKTOP_PLATFORM_DETAILS[platform].requirement}</span>
            </li>
          )}
        </For>
      </ul>
      <p class="downloads-note">
        <Show
          when={props.visitor === 'windows'}
          fallback={
            <>
              On another computer?{' '}
              <a href="/app" target="_self">
                Use Macro in your browser
              </a>
              .
            </>
          }
        >
          A native Windows app is on the way. Until then,{' '}
          <a href="/app" target="_self">
            use Macro in your browser
          </a>
          .
        </Show>
      </p>
    </>
  );
}

/**
 * The phone apps' QR codes behind an iPhone / Android toggle, starting on the
 * visitor's own phone platform (an Android tablet) and on iPhone otherwise.
 */
function MobileQrCodes(props: { initial: PhonePlatform | undefined }) {
  const [chosen, setChosen] = createSignal<PhonePlatform>();
  const store = () => chosen() ?? props.initial ?? 'ios';
  const details = () => PHONE_PLATFORM_DETAILS[store()];

  return (
    <section
      class="downloads-mobile downloads-desktop-only"
      aria-labelledby="mobile"
    >
      <h2 id="mobile">Mobile app</h2>
      <p>Scan the code to get Macro on your phone.</p>
      <Tabs
        aria-label="Phone"
        list={STORE_TABS}
        value={store()}
        onChange={(value) =>
          setChosen(PHONE_PLATFORMS.find((platform) => platform === value))
        }
      />
      <Dynamic
        component={STORE_QR_CODES[store()]}
        class="downloads-qr"
        role="img"
        aria-label={`QR code for ${details().store}`}
      />
      <a class="downloads-store-link" href={details().url}>
        {details().prompt}
      </a>
    </section>
  );
}
