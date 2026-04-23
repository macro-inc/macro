interface ImportMetaEnv {
  readonly __APP_VERSION__: string;
  readonly __LOCAL_JWT__: string;
  readonly __GIT_BRANCH__: string;
  readonly VITE_PLATFORM: 'web' | 'desktop' | 'ios' | 'android';

  readonly VITE_SEGMENT_WRITE_KEY: string;
  readonly VITE_DD_WEB_APP_ID: string;
  readonly VITE_DD_WEB_APP_TOKEN: string;
  readonly VITE_DD_HASH: string;
  readonly VITE_POSTHOG_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
