import '@fontsource-variable/inter';
import '../../../../index.css';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../../theme/themes/macro-dark';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { themeCssVars } from '../../../theme/utils/themeCssVars';
import { TeamSubteams } from '../../TeamSubteams';
import { authServiceClient } from './services';

function Fixture() {
  onMount(() => {
    const dark = new URLSearchParams(location.search).has('dark');
    for (const [key, value] of Object.entries(
      themeCssVars(dark ? macroDarkTheme : macroLightTheme)
    ))
      document.documentElement.style.setProperty(key, value);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themeLight = String(!dark);
  });

  return (
    <main class="h-dvh bg-panel text-ink">
      <TeamSubteams team={team} />
    </main>
  );
}

const team = (await authServiceClient.getUserTeams())._unsafeUnwrap()[0];
const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <Fixture />
      </QueryClientProvider>
    ),
    root
  );
