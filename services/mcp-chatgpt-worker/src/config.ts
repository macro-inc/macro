import { z } from 'zod';

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
};

const CONFIG = z.object({
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
      hosts ? z.record(z.string(), z.url()).parse(JSON.parse(hosts)) : undefined
    ),
});

export type Config = z.output<typeof CONFIG>;

/** Parse the bindings; a missing or malformed value fails the request loudly. */
export function parseConfig(bindings: Bindings): Config {
  return CONFIG.parse(bindings);
}
