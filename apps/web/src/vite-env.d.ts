interface ImportMetaEnv {
  readonly __APP_VERSION__: string;
  readonly __LOCAL_JWT__: string;
  readonly __GIT_BRANCH__: string;

  readonly VITE_SEGMENT_WRITE_KEY: string;
  readonly VITE_POSTHOG_API_KEY: string;

  readonly VITE_OTEL_EXPORTER_URL?: string;
  readonly VITE_OTEL_ENV?: string;
  readonly VITE_ENABLE_BROWSER_OTEL?: string;
  readonly VITE_ENABLE_REMINDERS?: string;
  readonly VITE_DISABLE_BROWSER_TURSO_CACHE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
