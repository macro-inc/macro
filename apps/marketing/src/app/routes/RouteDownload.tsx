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
  DESKTOP_RELEASE_URL,
  type DesktopInstaller,
  type DesktopPlatform,
  detectPhonePlatform,
  detectVisitorPlatform,
  installerLabel,
  installerPlatform,
  intelMacPublished,
  MAC_CHIP_HINT,
  type MacArchitecture,
  PHONE_PLATFORM_DETAILS,
  PHONE_PLATFORMS,
  type PhonePlatform,
  phonePlatformOrder,
  publishedInstallers,
  readMacArchitecture,
  type UserAgentData,
  type VisitorPlatform,
  visitorInstaller,
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

/** Undefined until the browser answers; `unknown` once it can't say. */
type ChipAnswer = MacArchitecture | 'unknown' | undefined;

async function loadMacArchitecture(set: (answer: ChipAnswer) => void) {
  const browser = navigator as Navigator & { userAgentData?: UserAgentData };
  set((await readMacArchitecture(browser.userAgentData)) ?? 'unknown');
}

export function RouteDownload() {
  setPageSeo({
    title: 'Download Macro Alpha',
    description: 'Download the Macro alpha desktop app for macOS and Linux.',
    path: '/download',
  });

  // The Intel Mac installer is offered once the edge links to it.
  const intel = intelMacPublished();
  const [visitor, setVisitor] = createSignal<VisitorPlatform>();
  const [phone, setPhone] = createSignal<PhonePlatform>();
  const [chip, setChip] = createSignal<ChipAnswer>();

  onMount(() => {
    const { userAgent, maxTouchPoints } = navigator;
    const visiting = detectVisitorPlatform(userAgent, maxTouchPoints);
    setVisitor(visiting);
    setPhone(detectPhonePlatform(userAgent, maxTouchPoints));
    // Only a Mac's own browser can say which chip it has. readMacArchitecture
    // never rejects: a refused hint reads as unknown.
    if (intel && visiting === 'macos') void loadMacArchitecture(setChip);
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
            fallback={<AnyInstaller visitor={visitor()} intel={intel} />}
          >
            {(platform) => (
              <VisitorInstaller
                platform={platform()}
                intel={intel}
                chip={chip()}
              />
            )}
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

/** A tracked link to an installer. */
function InstallerLink(props: {
  platform: DesktopInstaller;
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
 * The installer for the visitor's computer, with the others as quiet links so
 * they stay reachable. On a Mac, once Intel is published, the button is for
 * the chip the browser reports (Apple silicon when it can't say), the other
 * chip is the first link, and a browser that can't say gets a hint on finding
 * the chip.
 */
function VisitorInstaller(props: {
  platform: DesktopPlatform;
  intel: boolean;
  chip: ChipAnswer;
}) {
  const onMac = () => props.platform === 'macos';
  const primary = () =>
    visitorInstaller(
      props.platform,
      props.chip === 'unknown' ? undefined : props.chip,
      props.intel
    );
  const others = () =>
    publishedInstallers(props.intel).filter(
      (installer) => installer !== primary()
    );
  const label = (installer: DesktopInstaller) =>
    installerLabel(installer, props.intel, onMac());

  return (
    <>
      <ul class="downloads-installers" aria-label="Desktop installers">
        <li>
          <InstallerLink platform={primary()} class="site-nav-start">
            Download for {label(primary())}
          </InstallerLink>
          <span>{DESKTOP_PLATFORM_DETAILS[primary()].requirement}</span>
        </li>
      </ul>
      <p class="downloads-alternatives">
        Also available for{' '}
        <For each={others()}>
          {(installer, index) => (
            <>
              <Show when={index() > 0}> · </Show>
              <InstallerLink
                platform={installer}
                aria-label={`Download for ${label(installer)}`}
              >
                {label(installer)}
              </InstallerLink>
            </>
          )}
        </For>
      </p>
      <Show when={onMac() && props.intel && props.chip === 'unknown'}>
        <p class="downloads-alternatives">{MAC_CHIP_HINT}</p>
      </Show>
    </>
  );
}

/**
 * Every installer as an equal choice, for a computer Macro has no installer
 * for (Windows, ChromeOS) or one it can't detect, with the web app as the way
 * to use Macro there.
 */
function AnyInstaller(props: {
  visitor: VisitorPlatform | undefined;
  intel: boolean;
}) {
  return (
    <>
      <ul class="downloads-installers" aria-label="Desktop installers">
        <For each={publishedInstallers(props.intel)}>
          {(platform) => (
            <li>
              <InstallerLink platform={platform} class="site-nav-demo">
                Download for {installerLabel(platform, props.intel, false)}
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
