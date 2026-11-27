import '@fontsource-variable/inter';
import '../../../../index.css';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { QueryClientProvider } from '@tanstack/solid-query';
import { ImperativeDialogHost } from '@ui';
import { Layer } from '@ui/components/Layer';
import { render } from 'solid-js/web';
import { macroDarkTheme } from '../../../theme/themes/macro-dark';
import { macroLightTheme } from '../../../theme/themes/macro-light';
import { themeCssVars } from '../../../theme/utils/themeCssVars';
import { CursorConnectPage } from '../../CursorConnectPage';

// `?dark` renders the page in the dark theme.
const dark = new URLSearchParams(window.location.search).has('dark');
for (const [key, token] of Object.entries(
  themeCssVars(dark ? macroDarkTheme : macroLightTheme)
))
  document.documentElement.style.setProperty(key, token);
document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
document.documentElement.dataset.themeLight = String(!dark);
document.documentElement.dataset.touchDevice = String(isTouchDevice());

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: 'macro|ada@example.com',
  email: 'ada@example.com',
  authenticated: true,
});

const root = document.getElementById('root');
if (root)
  render(
    () => (
      <QueryClientProvider client={queryClient}>
        <UserContextProvider>
          <Layer>
            <div class="mx-auto max-w-3xl">
              <CursorConnectPage onClose={() => {}} />
            </div>
            <ImperativeDialogHost />
            <ToastRegion />
          </Layer>
        </UserContextProvider>
      </QueryClientProvider>
    ),
    root
  );
