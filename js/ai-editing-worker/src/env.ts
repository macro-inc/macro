import { envsafe, str } from 'envsafe';
import { createMiddleware } from 'hono/factory';

export type Bindings = {
  ANTHROPIC_API_KEY: string | undefined;
  CEREBRAS_API_KEY: string | undefined;
  OPENAI_API_KEY: string | undefined;
  SYNC_WS_BASE: string;
  DSS_BASE: string;
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
    },
    { env: rawEnv as Record<string, string | undefined> }
  );
}

export type EnvVariables = { env: Env };

export const envMiddleware = createMiddleware<{
  Bindings: Bindings;
  Variables: EnvVariables;
}>(async (c, next) => {
  let env: Env;
  try {
    env = validateEnv(c.env);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[env] validation failed: ${msg}`);
    return c.json({ error: `env misconfiguration: ${msg}` }, 500);
  }
  c.set('env', env);
  await next();
});
