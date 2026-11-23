import { Telemetry } from '@macro-inc/observability';
import {
  APICallError,
  type LanguageModelMiddleware,
  wrapLanguageModel,
} from 'ai';

/** A provider's model object, as the provider factories create it. */
export type ProviderModel = Parameters<typeof wrapLanguageModel>[0]['model'];

/**
 * Why a provider refused to serve Macro's account: it suspended the account,
 * or the account ran out of credit or reached its spending limit. Mirrors
 * `genai_telemetry::provider_account` in Rust, which documents each pattern;
 * keep the two in step.
 */
export type AccountUnavailable = 'suspended' | 'out_of_credit';

const SUSPENDED = [
  'is suspended',
  'has been suspended',
  'account_deactivated',
  'organization has been disabled',
];

const OUT_OF_CREDIT = [
  'credit balance is too low',
  'specified api usage limits',
  'insufficient_quota',
  'billing_hard_limit_reached',
  'billing_disabled',
  'spending limit',
];

/** Classify a provider's error response; rate limits are not account failures. */
export function accountUnavailable(
  status: number | undefined,
  body: string
): AccountUnavailable | undefined {
  if (status !== undefined && (status < 400 || status >= 500)) return;

  if (status === 402) return 'out_of_credit';

  const text = body.toLowerCase();
  if (SUSPENDED.some((pattern) => text.includes(pattern))) return 'suspended';
  if (OUT_OF_CREDIT.some((pattern) => text.includes(pattern)))
    return 'out_of_credit';
  return undefined;
}

/**
 * The span the `ai-provider-account-unavailable` span-based metric counts
 * (infra/stacks/monitoring/monitors/ai-providers.ts). Its name and the
 * `ai.provider`, `http.status_code` and `ai.account_unavailable` attributes
 * are that metric's contract. Worker logs do not reach Datadog; spans do.
 */
export const ACCOUNT_UNAVAILABLE_SPAN = 'ai.provider_account_unavailable';

function report(provider: string, error: unknown): void {
  if (!APICallError.isInstance(error)) return;

  const reason = accountUnavailable(
    error.statusCode,
    error.responseBody ?? error.message
  );
  if (reason === undefined) return;

  const span = Telemetry.span(ACCOUNT_UNAVAILABLE_SPAN);
  span.setAttr('ai.provider', provider);
  span.setAttr('ai.account_unavailable', reason);
  if (error.statusCode !== undefined)
    span.setAttr('http.status_code', error.statusCode);
  span.end();
}

/** `model`, recording a span whenever its provider refuses Macro's account. */
export function reportingAccountFailures(
  provider: string,
  model: ProviderModel
): ProviderModel {
  const middleware: LanguageModelMiddleware = {
    specificationVersion: 'v3',
    wrapGenerate: async ({ doGenerate }) => {
      try {
        return await doGenerate();
      } catch (error) {
        report(provider, error);
        throw error;
      }
    },
    wrapStream: async ({ doStream }) => {
      try {
        return await doStream();
      } catch (error) {
        report(provider, error);
        throw error;
      }
    },
  };
  return wrapLanguageModel({ model, middleware });
}
