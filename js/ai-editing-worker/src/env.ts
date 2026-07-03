import { envsafe, str } from 'envsafe';

export type Bindings = {
  ANTHROPIC_API_KEY: string | undefined;
  CEREBRAS_API_KEY: string | undefined;
  OPENAI_API_KEY: string | undefined;
  SYNC_WS_BASE: string;
};

export type Env = ReturnType<typeof validateEnv>;

function validateEnv(rawEnv: Bindings) {
  return envsafe(
    {
      ANTHROPIC_API_KEY: str({ allowEmpty: false }),
      CEREBRAS_API_KEY: str({ allowEmpty: false }),
      OPENAI_API_KEY: str({ allowEmpty: false }),
      SYNC_WS_BASE: str({ allowEmpty: false }),
    },
    { env: rawEnv as Record<string, string | undefined> }
  );
}

let cachedEnv: Env | undefined;
export function getEnv(rawEnv: Bindings): Env {
  if (cachedEnv === undefined) {
    cachedEnv = validateEnv(rawEnv);
  }

  return cachedEnv;
}
