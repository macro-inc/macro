import { envsafe, str } from 'envsafe';
import { createMiddleware } from 'hono/factory';

export type Bindings = {
  ANTHROPIC_API_KEY: string | undefined;
  CEREBRAS_API_KEY: string | undefined;
  OPENAI_API_KEY: string | undefined;
  SYNC_WS_BASE: string;
  DSS_BASE: string;
  SEARCH_SERVICE_BASE: string;
  CONTACTS_SERVICE_BASE: string;
  AUTH_SERVICE_BASE: string;
};

export type Env = ReturnType<typeof validateEnv>;

function validateEnv(rawEnv: Bindings) {
  return envsafe(
    {
      ANTHROPIC_API_KEY: str({ allowEmpty: false }),
      CEREBRAS_API_KEY: str({ allowEmpty: false }),
      OPENAI_API_KEY: str({ allowEmpty: false }),
      SYNC_WS_BASE: str({ allowEmpty: false }),
      DSS_BASE: str({ allowEmpty: false }),
      SEARCH_SERVICE_BASE: str({ allowEmpty: false }),
      CONTACTS_SERVICE_BASE: str({ allowEmpty: false }),
      AUTH_SERVICE_BASE: str({ allowEmpty: false }),
    },
    { env: rawEnv as Record<string, string | undefined> }
  );
}

export type EnvVariables = { env: Env };

export const envMiddleware = createMiddleware<{
  Bindings: Bindings;
  Variables: EnvVariables;
}>(async (c, next) => {
  c.set('env', validateEnv(c.env));
  await next();
});
