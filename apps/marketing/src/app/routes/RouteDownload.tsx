import MacroLogo from '@icon/macro-logo.svg';
import { FeaturePage } from '../../features/marketing/components/FeaturePage';
import { SectionMoreFeatures } from '../components/sections/SectionMoreFeatures';
import { setPageSeo } from '../utils/utilSeo';
import './RouteDownload.css';

export function RouteDownload() {
  setPageSeo({
    title: 'Download Macro - Coming Soon',
    description: 'Macro desktop app coming soon for macOS and Linux.',
    path: '/download',
  });

  return (
    <FeaturePage>
      <div class="downloads-page">
        <header class="downloads-header">
          <div class="downloads-app-icon" aria-hidden="true">
            <MacroLogo />
          </div>
          <h1>Coming Soon</h1>
          <p>The Macro desktop app will be available for macOS and Linux.</p>
        </header>
      </div>
      <SectionMoreFeatures currentPath="/download" footerOnly />
    </FeaturePage>
  );
}
