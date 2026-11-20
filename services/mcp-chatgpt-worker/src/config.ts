import { z } from 'zod';
import { keyBytes } from './person-tokens';

/** The Worker's bindings, as wrangler.jsonc declares them per environment. */
export type Bindings = {
  ENVIRONMENT?: string;
  MACRO_ENV?: string;
  RESOURCE_URL?: string;
  AUTHORIZATION_SERVER_URL?: string;
  TOOL_GROUPING?: string;
  MACRO_HOSTS?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
  DD_API_KEY?: string;
  OPENAI_APPS_CHALLENGE?: string;
  PERSON_TOKEN_KEY?: string;
};

const CONFIG = z
  .object({
    /** `deployment.environment` on exported spans. */
    ENVIRONMENT: z.string().min(1),
    /** Which Macro environment the SDK talks to; its hosts come from the SDK. */
    MACRO_ENV: z.enum(['local', 'dev', 'prod']),
    /** This server's MCP endpoint, the OAuth resource tokens are issued for. */
    RESOURCE_URL: z.url(),
    /** The OAuth authorization server (the harness's MCP broker). */
    AUTHORIZATION_SERVER_URL: z.url(),
    /** `entity` tools (`documents_read`) or one tool per operation. */
    TOOL_GROUPING: z.enum(['entity', 'method']),
    /** Local only: service hosts of a named local stack, as JSON. */
    MACRO_HOSTS: z
      .string()
      .optional()
      .transform((hosts) =>
        hosts
          ? z.record(z.string(), z.url()).parse(JSON.parse(hosts))
          : undefined
      ),
    /**
     * The domain verification token OpenAI's app dashboard issues for this
     * host, served at `/.well-known/openai-apps-challenge`. A secret in each
     * deployed env; unset, the path is a 404.
     */
    OPENAI_APPS_CHALLENGE: z.string().min(1).optional(),
    /**
     * The key person tokens are sealed with (base64, at least 32 bytes): every
     * user id and email a tool returns reaches ChatGPT as a token
     * (`src/person-tokens.ts`). A secret in each deployed env; a local run
     * without one gets a random key per isolate. Changing it voids every token
     * ChatGPT holds.
     */
    PERSON_TOKEN_KEY: z
      .string()
      .optional()
      .refine((secret) => secret === undefined || keyBytes(secret), {
        message: 'PERSON_TOKEN_KEY must be base64 of at least 32 bytes',
      }),
  })
  .refine((config) => config.MACRO_ENV === 'local' || config.PERSON_TOKEN_KEY, {
    message: 'PERSON_TOKEN_KEY is required outside local',
    path: ['PERSON_TOKEN_KEY'],
  });

export type Config = z.output<typeof CONFIG>;

/** Parse the bindings; a missing or malformed value fails the request loudly. */
export function parseConfig(bindings: Bindings): Config {
  return CONFIG.parse(bindings);
}
