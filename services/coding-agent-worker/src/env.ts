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
  MACRO_BOT_TOKEN: str({
    desc: 'mbot_ key (Settings → Bots); the SDK also reads this from the environment itself',
  }),
  MACRO_USER_ID: str({
    desc: 'Macro user ID the bot is authorized to act as',
  }),
  PUBLIC_URL: url({
    desc: 'Public base url Macro webhooks can reach this worker at (e.g. an ngrok tunnel)',
  }),
  UPSTREAM_WS_URL: url({
    devDefault: 'ws://localhost:4001',
    desc: 'Preconfigured upstream websocket; the worker adds its session id as the id query parameter',
  }),
  GITHUB_TOKEN: str({
    desc: 'Token with read access to the repos we clone into sandboxes',
  }),
  ANTHROPIC_API_KEY: str({
    default: '',
    allowEmpty: true,
    desc: 'Forwarded into sandboxes so opencode can call Anthropic. Empty = agent falls back to free models.',
  }),
  LOG_LEVEL: str({
    default: 'info',
    choices: ['debug', 'info', 'warn', 'error', 'silent'],
    desc: 'Minimum log level. `debug` dumps every ACP frame crossing the upstream link and the agent stream.',
  }),
})
