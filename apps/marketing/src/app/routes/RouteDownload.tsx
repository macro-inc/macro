import MacroLogo from '@icon/macro-logo.svg';
import { FeaturePage } from '../../features/marketing/components/FeaturePage';
import { setPageSeo } from '../utils/utilSeo';
import '../../features/documentation/components/documentation.css';
import './RouteDownload.css';

export function RouteDownload() {
  setPageSeo({
    title: 'Download Macro',
    description:
      'Use Macro in your browser or on iOS. Desktop apps for macOS and Linux are coming soon.',
    path: '/download',
  });
  return (
    <FeaturePage>
      <div class="downloads-page">
        <header class="downloads-header">
          <div class="downloads-app-icon" aria-hidden="true">
            <MacroLogo />
          </div>
          <h1>Get Macro.</h1>
          <p>Use Macro in your browser or on your iPhone.</p>
        </header>
        <article class="documentation-body">
          <h2 id="web">Web</h2>
          <p>
            <a href="/app">Open Macro</a> in a modern browser. No installation
            needed.
          </p>
          <h2 id="ios">iOS</h2>
          <p>
            <a href="https://apps.apple.com/us/app/macro-app/id6743133649">
              Download Macro from the App Store
            </a>
            . You can also open <strong>Settings → Mobile App</strong> in Macro
            and scan the QR code.
          </p>
          <p>
            Splits, keyboard shortcuts, and some account and connection settings
            are available on the web.{' '}
            <span id="android">Android is not available yet.</span>
          </p>
          <h2 id="desktop">Desktop</h2>
          <p>
            The Macro desktop app is coming soon for macOS and Linux. Use the
            web app in the meantime.
          </p>
          <p>
            For self-hosting, see the{' '}
            <a href="/docs/security#self-hosting">self-hosting overview</a>.
          </p>
        </article>
      </div>
    </FeaturePage>
  );
}
