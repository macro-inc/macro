import '../../index.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-mono';
import { applyTheme, resolveActiveThemeId } from '@theme/utils/themeUtils';
import { onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { parseScenario, type ScenarioId } from './core/billing-simulation';
import { createBillingLab } from './create-billing-lab';
import { BillingLabView } from './views/billing-lab';

function BillingLab() {
  const lab = createBillingLab(
    parseScenario(new URLSearchParams(window.location.search).get('scenario'))
  );
  const onSelect = (scenario: ScenarioId) => {
    lab.selectScenario(scenario);
    const url = new URL(window.location.href);
    url.searchParams.set('scenario', scenario);
    window.history.pushState({}, '', url);
  };
  const onPopState = () =>
    lab.selectScenario(
      parseScenario(new URLSearchParams(window.location.search).get('scenario'))
    );
  window.addEventListener('popstate', onPopState);
  onCleanup(() => window.removeEventListener('popstate', onPopState));
  return <BillingLabView lab={lab} onSelect={onSelect} />;
}

// This HTML entry is deliberately absent from Vite's production build inputs.
// HMR is the same local-only gate used by the app's other local developer tools.
if (import.meta.hot) {
  applyTheme(resolveActiveThemeId());
  const root = document.getElementById('root');
  if (root) render(() => <BillingLab />, root);
}
