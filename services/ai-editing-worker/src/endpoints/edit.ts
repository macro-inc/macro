import { createAnthropic } from '@ai-sdk/anthropic';
import { createCerebras } from '@ai-sdk/cerebras';
import { createOpenAI } from '@ai-sdk/openai';
import { zValidator } from '@hono/zod-validator';
import type { LanguageModel } from 'ai';
import { createFallback } from 'ai-fallback';
import { Hono } from 'hono';
import * as z from 'zod';
import { type Bindings, getEnv } from '../env';
import { type Model, type ResolvedModels, runEditSession } from '../run-edit';
import { runInSandbox } from '../sandbox';
import { watchPresenceSpeed } from '../service-clients';
import { createWorkerSyncSource } from '../sources';
import { renderTraceMarkdown } from '../trace-log';
import { insertEditTrace } from '../traces-db';

type Provider = 'anthropic' | 'cerebras' | 'openai';

const PROVIDERS = {
  anthropic: { key: 'ANTHROPIC_API_KEY', create: createAnthropic },
  cerebras: { key: 'CEREBRAS_API_KEY', create: createCerebras },
  openai: { key: 'OPENAI_API_KEY', create: createOpenAI },
} satisfies Record<
  Provider,
  {
    key: keyof Bindings;
    create: (opts: { apiKey: string }) => (modelId: string) => LanguageModel;
  }
>;

const ModelSchema: z.ZodType<Model> = z.object({
  provider: z.enum(['anthropic', 'cerebras', 'openai']),
  model: z.string(),
});

// Each role takes a non-empty list of models tried in order: the first is
// primary, the rest are fallbacks used in order, only when a provider errors or
// rate-limits.
const ModelListSchema = z.array(ModelSchema).min(1);

const EditBody = z.object({
  documentToken: z.string(),
  documentId: z.string(),
  prompt: z.string(),
  models: z.object({
    supervisor: ModelListSchema,
    interpret: ModelListSchema,
    coding: ModelListSchema,
  }),
  typingAnimations: z.boolean().optional(),
  /** Animation speed multiplier applied while nobody is watching the doc. */
  unwatchedSpeed: z.number().min(1).default(2.0),
  interpret: z.boolean().default(true),
  debug: z.boolean().default(false),
  /**
   * Commit edits to the shared Loro doc (default true). Set false to have the
   * worker compute ops without committing them. This gives you the flexibility
   * to apply them on your own.
   */
  propagate: z.boolean().default(true),
});

/** Resolve each role's model list into a live model (single) or a fallback
 *  chain (multiple, advancing on provider errors/rate limits). */
function buildModels(
  env: ReturnType<typeof getEnv>,
  models: EditModels
): ResolvedModels {
  const resolveOne = ({ provider, model }: Model) => {
    const apiKey = env[PROVIDERS[provider].key];
    return PROVIDERS[provider].create({ apiKey })(model);
  };
  const resolveModel = (specs: Model[]): LanguageModel => {
    const resolved = specs.map(resolveOne);
    if (resolved.length === 1) return resolved[0];
    return createFallback({
      models: resolved,
      onError: (error, modelId) =>
        console.error(`edit model ${modelId} failed, falling back:`, error),
    });
  };
  return {
    supervisor: resolveModel(models.supervisor),
    interpret: resolveModel(models.interpret),
    // Fresh fallback per coder — see ResolvedModels.coding.
    coding: () => resolveModel(models.coding),
  };
}

type EditModels = z.infer<typeof EditBody>['models'];

const edit = new Hono<{ Bindings: Bindings }>();

edit.post('/', zValidator('json', EditBody), async (c) => {
  const env = getEnv(c.env);
  const {
    documentToken,
    documentId,
    prompt,
    models,
    typingAnimations,
    unwatchedSpeed,
    interpret,
    debug,
    propagate,
  } = c.req.valid('json');

  // FYI cancellation only works on live cloudflare not workerd. And it requires enable_request_signal.
  const signal = c.req.raw.signal;
  signal.addEventListener('abort', () => {
    console.log('edit session cancelled by client:', documentId);
  });

  try {
    const wsUrl = `${env.SYNC_WS_BASE}/document/${documentId}/connect?token=${documentToken}`;
    const source = createWorkerSyncSource(wsUrl, documentId, signal);

    // Animations play at 1x while a human is watching and speed up to
    // `unwatchedSpeed` when nobody is, so unseen edits finish faster without
    // being skipped. Presence is re-polled throughout, so a viewer who joins
    // mid-edit slows it back to 1x.
    const presence = watchPresenceSpeed({
      syncWsBase: env.SYNC_WS_BASE,
      documentId,
      docToken: documentToken,
      unwatchedSpeed,
      signal,
    });
    const sleep = (ms: number) =>
      new Promise<void>((resolve) =>
        setTimeout(resolve, ms / presence.multiplier())
      );

    const { usage, ops, session, clarification } = await runEditSession({
      source,
      documentId,
      prompt,
      models: buildModels(env, models),
      typingAnimations,
      sleep,
      interpret,
      debug,
      propagate,
      runner: runInSandbox,
      signal,
    }).finally(presence.stop);

    const db = c.env.TRACES_DB;
    if (db) {
      c.executionCtx.waitUntil(
        insertEditTrace(db, {
          id: session.sessionId,
          document_id: documentId,
          created_at: Date.now(),
          trace_json: JSON.stringify(session),
        }).catch((e) => {
          console.error('failed to persist edit trace:', e);
        })
      );
    }

    return c.json({
      ok: true,
      usage,
      ops,
      trace: debug ? renderTraceMarkdown(session) : undefined,
      clarification,
    });
  } catch (err) {
    if (!(err instanceof Error)) throw new Error(String(err));
    if (!signal.aborted) {
      console.error('edit session failed:', err.message, err.stack);
    }
    const status = (signal.aborted ? 499 : 502) as 502;
    return c.json({ error: err.message }, status);
  }
});

export default edit;
