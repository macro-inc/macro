import { envsafe, str, url } from 'envsafe'

// Validated at import time: the process fails at boot with a readable report
// if anything is missing, instead of erroring on the first request.
export const env = envsafe({
  DAYTONA_API_KEY: str({
    desc: 'Daytona API key (the SDK also reads this from the environment itself)',
  }),
  DAYTONA_API_URL: url({
    default: 'https://app.daytona.io/api',
  }),
  DAYTONA_TARGET: str({
    default: 'us',
  }),
  UPSTREAM_WS_URL: url({
    devDefault: 'ws://localhost:4001',
    desc: 'Preconfigured upstream websocket the worker dials to stream system + acp messages',
  }),
  GITHUB_TOKEN: str({
    desc: 'Token with read access to the repos we clone into sandboxes',
  }),
  ANTHROPIC_API_KEY: str({
    default: '',
    allowEmpty: true,
    desc: 'Forwarded into sandboxes so opencode can call Anthropic. Empty = agent falls back to free models.',
  }),
})
