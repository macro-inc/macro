import type { CapacitorConfig } from '@capacitor/cli';

const ENV_MODE = process.env.MODE ?? 'development';

const appId =
  ENV_MODE === 'production' ? 'com.macro.app.prod' : 'com.macro.app.dev';

const appName = ENV_MODE === 'production' ? 'Macro' : 'Macro Dev';

const url =
  ENV_MODE === 'production'
    ? 'https://macro.com/app'
    : 'https://dev.macro.com/app';

const scheme = ENV_MODE === 'production' ? 'Macro' : 'Macro Dev';

const config: CapacitorConfig = {
  appId,
  appName,
  backgroundColor: '#FFFFFF',
  server: {
    url,
  },
  ios: {
    scheme,
    allowsLinkPreview: false,
  },
  android: {
    adjustMarginsForEdgeToEdge: 'force',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'DEFAULT',
      backgroundColor: '#222222',
    }
  },
};

export default config;
