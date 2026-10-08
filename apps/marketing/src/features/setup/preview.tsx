/** Public homepage and shared signup introduction. Connections continue in the app. */
import '../../styles/site-ui.css';
import '../../styles/dark-theme.css';
import '../../styles/fonts.css';
import './cream-preview.css';
import { lazy } from 'solid-js';
import { hydrate, render } from 'solid-js/web';
import { analytics } from '../../app/utils/utilAnalytic';
import { buildAppUrl } from '../../app/utils/utilBaseUrl';
import { Homepage } from './Homepage';

// The homepage does not need the account, integration, and team setup screens.
const PublicOnboarding = lazy(async () => {
  const module = await import('./views/PublicOnboarding');
  return { default: module.PublicOnboarding };
});

function Preview() {
  document.documentElement.dataset.themeLight = cream ? 'true' : 'false';
  if (window.location.pathname !== '/') {
    const loginUrl = new URL(
      import.meta.env.DEV
        ? `/app/login${window.location.search}`
        : buildAppUrl('/app/login'),
      window.location.origin
    );
    const params = new URLSearchParams(window.location.search);
    for (const key of ['next', 'referral_code']) {
      const value = params.get(key);
      if (value) loginUrl.searchParams.set(key, value);
    }
    return (
      <PublicOnboarding
        loginUrl={loginUrl.toString()}
        preview={import.meta.env.DEV}
        onFeaturesSelected={(features) =>
          analytics.trackPosthog('onboarding_v4_features_selected', {
            features,
            feature_count: features.length,
            source: 'public_onboarding',
          })
        }
      />
    );
  }

  return <Homepage />;
}
// `?theme=cream` previews the homepage in the cream palette; see cream-preview.css.
const cream =
  new URLSearchParams(window.location.search).get('theme') === 'cream';
if (cream) {
  document.documentElement.dataset.palette = 'cream';
  document.documentElement.dataset.themeLight = 'true';
}

const root = document.getElementById('root');
if (root) {
  if (root.hasAttribute('data-hydrate-homepage')) {
    hydrate(() => <Homepage />, root);
  } else {
    root.textContent = '';
    render(() => <Preview />, root);
  }
  root.dataset.publicReady = 'true';
}
