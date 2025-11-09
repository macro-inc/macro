declare global {
  interface ImportMeta {
    env: {
      NODE_ENV: 'production' | 'development'
      PROD: boolean
      DEV: boolean
    }
  }
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'production' | 'development'
      // Environment variables are strings in Node's ProcessEnv
      PROD?: string
      DEV?: string
      SSR?: string
    }
  }
}

export {}
