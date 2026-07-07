import { envsafe, str } from 'envsafe';
import type { D1Database } from './traces-db';

export type Bindings = {
  ANTHROPIC_API_KEY: string | undefined;
  CEREBRAS_API_KEY: string | undefined;
  OPENAI_API_KEY: string | undefined;
  SYNC_WS_BASE: string;
  /** D1 database storing edit-session traces. Absent in envs without the binding. */
  TRACES_DB: D1Database | undefined;
  /** Shared admin key gating the trace-read endpoint; validated via getEnv. */
  TRACE_ADMIN_KEY: string | undefined;
};

export type Env = ReturnType<typeof validateEnv>;

function validateEnv(rawEnv: Bindings) {
  return envsafe(
    {
      ANTHROPIC_API_KEY: str({ allowEmpty: false }),
      CEREBRAS_API_KEY: str({ allowEmpty: false }),
      OPENAI_API_KEY: str({ allowEmpty: false }),
      SYNC_WS_BASE: str({ allowEmpty: false }),
      // Empty when unset; the trace-read endpoint stays closed until it's set.
      TRACE_ADMIN_KEY: str({ default: '', allowEmpty: true }),
    },
    // Cast through unknown: Bindings carries the TRACES_DB object binding, which
    // envsafe's string-record env type can't represent.
    { env: rawEnv as unknown as Record<string, string | undefined> }
  );
}

let cachedEnv: Env | undefined;
export function getEnv(rawEnv: Bindings): Env {
  if (cachedEnv === undefined) {
    cachedEnv = validateEnv(rawEnv);
  }

  return cachedEnv;
}
