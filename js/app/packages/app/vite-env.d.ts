interface ImportMetaEnv {
  readonly __APP_VERSION__: string;
  readonly __LOCAL_GQL_SERVER__: boolean;
  readonly __MACRO_GQL_SERVICE__: string;
  readonly __LOCAL_JWT__: string;
  readonly VITE_PLATFORM: 'web' | 'desktop' | 'ios' | 'android';

  readonly VITE_SEGMENT_WRITE_KEY: string;
  readonly VITE_DD_WEB_APP_ID: string;
  readonly VITE_DD_WEB_APP_TOKEN: string;
  readonly VITE_DD_HASH: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
