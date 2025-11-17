import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Dialog } from '@capacitor/dialog';
import { Filesystem } from '@capacitor/filesystem';
import { Keyboard, KeyboardStyle } from '@capacitor/keyboard';
import { Preferences } from '@capacitor/preferences';
import { PushNotifications } from '@capacitor/push-notifications';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, type StatusBarInfo, Style } from '@capacitor/status-bar';
import { SignInWithApple } from '@capacitor-community/apple-sign-in';
import { updateUserAuth, useIsAuthenticated } from '@core/auth';
import { useLogout } from '@core/auth/logout';
import { TabContent, TabContentRow } from '@core/component/TabContent';
import { TextButton } from '@core/component/TextButton';
import { useSettingsState } from '@core/constant/SettingsState';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { setKeyboardVisible } from '@core/mobile/virtualKeyboardDetection';
import { unsetTokenPromise } from '@core/util/fetchWithToken';
import { isErr, isOk } from '@core/util/maybeResult';
import { oklchToHex } from '@core/util/oklchToRgb';
import { uploadFile } from '@core/util/upload';
import { propsToHref } from '@core/util/url';
import Bell from '@icon/regular/bell.svg';
import BellSlash from '@icon/regular/bell-slash.svg';
import { authServiceClient } from '@service-auth/client';
import { state, ws } from '@service-connection/websocket';
import { gqlServiceClient, updateUserInfo } from '@service-gql/client';
import { notificationServiceClient } from '@service-notification/client';
import type { PushNotificationData } from '@service-notification/generated/schemas/pushNotificationData';
import { type AsyncStorage, makePersisted } from '@solid-primitives/storage';
import { useNavigate } from '@solidjs/router';
import { WebSocketState } from '@websocket/index';
import { toast } from 'core/component/Toast/Toast';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { themeReactive } from '../../../block-theme/signals/themeReactive';

const hasPushNotifications = Capacitor.isPluginAvailable('PushNotifications');
const hasStatusBar = Capacitor.isPluginAvailable('StatusBar');
const hasKeyboard = Capacitor.isPluginAvailable('Keyboard');
const hasSplashScreen = Capacitor.isPluginAvailable('SplashScreen');
const hasPreferences = Capacitor.isPluginAvailable('Preferences');

const preferencesStorage: AsyncStorage = {
  getItem: async function (key: string) {
    if (!hasPreferences) return null;

    const { value } = await Preferences.get({ key });
    return value;
  },
  setItem: async function (key: string, value: string) {
    if (!hasPreferences) return null;

    return Preferences.set({ key, value });
  },
  removeItem: async function (key: string) {
    if (!hasPreferences) return;

    return Preferences.remove({ key });
  },
};

export const [notificationEnabled, setNotificationEnabled] = makePersisted(
  createSignal(false),
  {
    storage: preferencesStorage,
  }
);

export const [notificationToken, setNotificationToken] = makePersisted(
  createSignal(''),
  {
    storage: preferencesStorage,
  }
);

const appleClientId =
  import.meta.env.MODE === 'production'
    ? 'com.macro.app.prod'
    : 'com.macro.app.dev';
export async function nativeAppleLogin() {
  if (isNativeMobilePlatform() !== 'ios') return;

  const { response } = await SignInWithApple.authorize({
    clientId: appleClientId,
    redirectURI: 'https://dev.macro.com/app/',
    scopes: 'email name',
  });

  const maybeResult = await authServiceClient.appleLogin({
    code: response.authorizationCode,
    id_token: response.identityToken,
  });

  if (isErr(maybeResult)) return toast.failure('Failed to login with Apple');

  return window.location.reload();
}

export async function deleteAccount() {
  const logout = useLogout();
  const { value } = await Dialog.confirm({
    title: 'Delete Account',
    message: 'Are you sure you want to delete your account?',
  });

  if (value) {
    await unregisterFromPushNotifications();
    const maybeResult = await authServiceClient.deleteUser();
    if (isErr(maybeResult) || !maybeResult[1].success)
      return toast.failure('Failed to delete account');

    await logout('/app/login');
  }
}

export async function registerForPushNotifications() {
  const permission = await PushNotifications.requestPermissions();
  if (permission.receive !== 'granted') {
    setNotificationEnabled(false);
    return toast.alert(
      'Push notifications is disabled. Please enable it in settings and try again.'
    );
  }

  PushNotifications.register();
}

export async function unregisterFromPushNotifications() {
  PushNotifications.unregister();
  const token = notificationToken();
  const deviceType = isNativeMobilePlatform();
  if (!token || !deviceType) return;

  const maybeResult = await notificationServiceClient.unregisterDevice({
    deviceType,
    token,
  });
  if (isErr(maybeResult)) {
    console.error('Error unregistering device', maybeResult);
    toast.failure('Failed to unregister device from push notifications');
  }

  setNotificationEnabled(false);
  setNotificationToken('');
}

export function useMobileNavigate() {
  if (!isNativeMobilePlatform()) return;

  const navigate = useNavigate();
  const isAuthenticated = useIsAuthenticated();
  const { closeSettings } = useSettingsState();

  App.addListener('appUrlOpen', async (event) => {
    if (event.url.startsWith('file://') && isAuthenticated()) {
      const { data } = await Filesystem.readFile({
        path: event.url,
      });

      const fileName = event.url.split('/').pop();
      if (fileName && fileName.endsWith('.pdf')) {
        const binaryString = atob(data as string);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const pdfFile = new File([bytes], fileName, {
          type: 'application/pdf',
        });
        const upload = await uploadFile(pdfFile, 'dss', {
          fileType: 'pdf',
        });
        if (!upload.failed && upload.type === 'document') {
          const href = propsToHref({
            fileType: 'pdf',
            id: upload.documentId,
          });
          navigate(href, {
            state: {
              upload: pdfFile,
            },
          });
        }
        closeSettings();
      }

      return;
    }

    const url = new URL(event.url);

    const session_code = url.searchParams.get('session_code');
    if (session_code) {
      url.searchParams.delete('session_code');
      unsetTokenPromise();
      authServiceClient.getUserInfo.invalidate();
      gqlServiceClient.getUserInfo.invalidate();

      const maybeResult = await authServiceClient.sessionLogin({
        session_code,
      });
      if (isOk(maybeResult)) {
        updateUserAuth();
        updateUserInfo();
      }
    }

    const route = url.toString().split('/app').pop();
    if (route) navigate(route);
  });

  PushNotifications.addListener(
    'pushNotificationActionPerformed',
    ({ notification }) => {
      const notificationData = notification.data as PushNotificationData;
      closeSettings();
      navigate(notificationData.openRoute);
    }
  );
}

export function useMobileEffect() {
  if (!isNativeMobilePlatform()) return;

  const isAuthenticated = useIsAuthenticated();

  App.addListener('resume', () => {
    const wsState = state();
    if (wsState === WebSocketState.Closed || wsState === WebSocketState.Closing)
      ws.reconnect();
  });

  // Estimates if the theme is light or dark based on the surface lightness
  const isLightTheme = createMemo(() => {
    return themeReactive.b0.l[0]() > 0.5;
  });

  if (hasStatusBar) {
    StatusBar.setOverlaysWebView({ overlay: false });

    createEffect(() => {
      const oklchColor = `oklch(${themeReactive.b0.l[0]()} ${themeReactive.b0.c[0]()} ${themeReactive.b0.h[0]()})`;
      const rgbColor = oklchToHex(oklchColor);
      StatusBar.setStyle({ style: isLightTheme() ? Style.Light : Style.Dark });
      if (!rgbColor) return;
      StatusBar.setBackgroundColor({ color: rgbColor });
    });
  }

  if (hasKeyboard) {
    Keyboard.setAccessoryBarVisible({ isVisible: false });
    Keyboard.addListener('keyboardWillShow', (info) => {
      document.documentElement.style.setProperty(
        '--keyboard-height',
        `${info.keyboardHeight}px`
      );
      setKeyboardVisible(true);
    });
    Keyboard.addListener('keyboardWillHide', () => {
      document.documentElement.style.setProperty('--keyboard-height', '0px');
      setKeyboardVisible(false);
    });

    createEffect(() => {
      if (isLightTheme()) {
        Keyboard.setStyle({ style: KeyboardStyle.Light });
      } else {
        Keyboard.setStyle({ style: KeyboardStyle.Dark });
      }
    });
  }

  const deviceType = isNativeMobilePlatform();
  if (hasPushNotifications && deviceType) {
    PushNotifications.addListener('registration', async ({ value: token }) => {
      setNotificationEnabled(true);
      setNotificationToken(token);
      const maybeResult = await notificationServiceClient.registerDevice({
        deviceType,
        token,
      });

      if (isErr(maybeResult)) {
        console.error('Error registering device to user', maybeResult);
        toast.failure('Failed to register device for push notifications');
        setNotificationEnabled(false);
      }
    });

    PushNotifications.addListener('registrationError', (error) => {
      console.error('Error registering device', error);
      toast.failure('Failed to enable push notifications');
      setNotificationEnabled(false);
    });

    onMount(() =>
      PushNotifications.checkPermissions().then((permission) => {
        if (
          permission.receive === 'granted' &&
          isAuthenticated() &&
          notificationEnabled()
        ) {
          registerForPushNotifications();
        } else if (permission.receive === 'denied') {
          setNotificationEnabled(false);
        }
      })
    );
  }

  if (hasSplashScreen) {
    onMount(() => {
      SplashScreen.hide();
    });
  }
}

export function Mobile() {
  const [statusBarInfo, setStatusBarInfo] = createSignal<StatusBarInfo>();

  const updateStatusBarInfo = () => StatusBar.getInfo().then(setStatusBarInfo);
  onMount(() => {
    updateStatusBarInfo();
    window.addEventListener('statusTap', updateStatusBarInfo);
  });
  onCleanup(() => window.removeEventListener('statusTap', updateStatusBarInfo));

  return (
    <TabContent title="Mobile Dev Tools">
      <div class="mb-12">
        <TabContentRow
          text="Push Notifications"
          subtext="Enable push notifications"
        >
          <div class="flex items-center gap-1 mt-2">
            <TextButton
              text="Enable"
              icon={Bell}
              onClick={registerForPushNotifications}
              theme={notificationEnabled() ? 'accent' : 'base'}
            />
            <TextButton
              text="Disable"
              icon={BellSlash}
              onClick={unregisterFromPushNotifications}
              theme={notificationEnabled() ? 'base' : 'accent'}
            />
          </div>
        </TabContentRow>
        <TabContentRow
          text="Push Notifications Token"
          subtext="Token for push notifications"
        >
          <div class="flex items-center gap-1 mt-2 text-wrap">
            {notificationToken()}
          </div>
        </TabContentRow>
        <TabContentRow text="Status Bar" subtext="Status bar information">
          <Show when={statusBarInfo()} fallback="Unavailable">
            {(info) => (
              <div class="flex items-center gap-2 mt-2">
                <div>
                  Status Bar: {info().visible ? 'Visible' : 'Hidden'}
                  {info().overlays ? ' with overlays' : ' without overlays'}
                </div>
                <div>Style: {info().style}</div>
                <div>Color: {info().color}</div>
              </div>
            )}
          </Show>
          <div class="flex items-center gap-1 mt-2">
            <TextButton
              text={statusBarInfo()?.visible ? 'Hide' : 'Show'}
              onClick={async () => {
                if (statusBarInfo()?.visible) {
                  await StatusBar.hide();
                } else {
                  await StatusBar.show();
                }
                updateStatusBarInfo();
              }}
              theme={statusBarInfo()?.visible ? 'accent' : 'base'}
            />
            <TextButton
              text="Toggle Overlays"
              onClick={async () => {
                await StatusBar.setOverlaysWebView({
                  overlay: !statusBarInfo()?.overlays,
                });
                updateStatusBarInfo();
              }}
              theme={statusBarInfo()?.overlays ? 'accent' : 'base'}
            />
            <TextButton
              text="Toggle Style"
              onClick={async () => {
                await StatusBar.setStyle({
                  style:
                    statusBarInfo()?.style === Style.Dark
                      ? Style.Light
                      : Style.Dark,
                });
                updateStatusBarInfo();
              }}
              theme={statusBarInfo()?.style === Style.Dark ? 'accent' : 'base'}
            />
            <input
              type="color"
              value={statusBarInfo()?.color}
              onChange={(e) =>
                StatusBar.setBackgroundColor({ color: e.target.value })
              }
            />
          </div>
        </TabContentRow>
      </div>
    </TabContent>
  );
}
