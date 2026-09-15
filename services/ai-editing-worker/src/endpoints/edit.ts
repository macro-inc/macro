import { createAnthropic } from '@ai-sdk/anthropic';
import { createCerebras } from '@ai-sdk/cerebras';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { zValidator } from '@hono/zod-validator';
import { Telemetry } from '@macro-inc/observability';
import type { LanguageModel } from 'ai';
import { createFallback } from 'ai-fallback';
import { Hono } from 'hono';
import * as z from 'zod';
import { type Bindings, getEnv } from '../env';
import {
  type EditMode,
  type Model,
  type Provider,
  type ResolvedModels,
  runEditSession,
} from '../run-edit';
import { runInSandbox } from '../sandbox';
import { watchPresenceSpeed } from '../service-clients';
import { createWorkerSyncSource } from '../sources';
import { renderTraceMarkdown } from '../trace-log';
import { insertEditTrace } from '../traces-db';

const PROVIDERS = {
  anthropic: { key: 'ANTHROPIC_API_KEY', create: createAnthropic },
  cerebras: { key: 'CEREBRAS_API_KEY', create: createCerebras },
  google: {
    key: 'GOOGLE_GENERATIVE_AI_API_KEY',
    create: createGoogleGenerativeAI,
  },
  // `.chat()` pins OpenAI to Chat Completions. The default factory uses the
  // Responses API, which references reasoning items across steps by id — and
  // this org has Zero Data Retention, so those ids are never persisted. Every
  // multi-step edit then dies on:
  //   "Item with id 'rs_...' not found. Items are not persisted for Zero Data
  //    Retention organizations."
  // The supervisor chain ends in gpt-5.5, so without this the last-resort
  // fallback fails outright whenever both Anthropic models are unavailable —
  // exactly when it is needed.
  openai: {
    key: 'OPENAI_API_KEY',
    create: (opts: { apiKey: string }) => {
      const provider = createOpenAI(opts);
      return (modelId: string) => provider.chat(modelId);
    },
  },
} satisfies Record<
  Provider,
  {
    key: keyof Bindings;
    create: (opts: { apiKey: string }) => (modelId: string) => LanguageModel;
  }
>;

const ModelSchema: z.ZodType<Model> = z.object({
  provider: z.enum(['anthropic', 'cerebras', 'openai', 'google']),
  model: z.string(),
});

// Each role takes a non-empty list of models tried in order: the first is
// primary, the rest are fallbacks used in order, only when a provider errors or
// rate-limits.
const ModelListSchema = z.array(ModelSchema).min(1);

const EditBody = z
  .object({
    documentToken: z.string(),
    documentId: z.string(),
    prompt: z.string(),
    // Each role is a chain; a request only has to name the roles its mode
    // runs (see the refinements below), and only those are resolved.
    models: z.object({
      supervisor: ModelListSchema.optional(),
      interpret: ModelListSchema.optional(),
      coding: ModelListSchema.optional(),
      /** Single-model chain for `mode: 'fast'`. */
      fast: ModelListSchema.optional(),
    }),
    /**
     * `supervised` (default): interpreter → supervisor → parallel coders.
     * `fast`: one model, whole document, direct `runCode` — the hot path for
     * small inline edits. Requires `models.fast`.
     */
    mode: z.enum(['supervised', 'fast']).default('supervised'),
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
  })
  .refine((body) => body.mode !== 'fast' || body.models.fast !== undefined, {
    message: 'mode "fast" requires models.fast',
    path: ['models', 'fast'],
  })
  .refine(
    (body) =>
      body.mode !== 'supervised' ||
      (body.models.supervisor !== undefined &&
        body.models.interpret !== undefined &&
        body.models.coding !== undefined),
    {
      message:
        'mode "supervised" requires models.supervisor, models.interpret, and models.coding',
      path: ['models'],
    }
  );

/** Resolve the mode's model lists into live models (single) or fallback
 *  chains (multiple, advancing on provider errors/rate limits). Roles the mode
 *  does not run are left unresolved, so their providers' keys are never
 *  required. The schema refinements guarantee the mode's roles are present. */
function buildModels(
  env: ReturnType<typeof getEnv>,
  models: EditModels,
  mode: EditMode,
  onFallback?: () => void
): ResolvedModels {
  const resolveOne = ({ provider, model }: Model) => {
    const { key, create } = PROVIDERS[provider];
    const apiKey = env[key];
    if (!apiKey) {
      throw new Error(`provider "${provider}" requested but ${key} is not set`);
    }
    return create({ apiKey })(model);
  };
  const resolveModel = (specs: Model[]): LanguageModel => {
    const resolved = specs.map(resolveOne);
    if (resolved.length === 1) return resolved[0];
    return createFallback({
      models: resolved,
      onError: (error, modelId) => {
        onFallback?.();
        console.error(`edit model ${modelId} failed, falling back:`, error);
      },
    });
  };
  const required = (role: keyof EditModels): Model[] => {
    const specs = models[role];
    if (!specs) throw new Error(`mode "${mode}" requires models.${role}`);
    return specs;
  };
  if (mode === 'fast') return { fast: resolveModel(required('fast')) };
  return {
    supervised: {
      supervisor: resolveModel(required('supervisor')),
      interpret: resolveModel(required('interpret')),
      coding: () => resolveModel(required('coding')),
    },
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
    mode,
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

    const { usage, ops, session, clarification } = await Telemetry.span(
      'edit.session',
      async (span) => {
        span.setAttr('document.id', documentId);
        span.setAttr('edit.mode', mode);
        span.setAttr('edit.interpret', interpret);
        span.setAttr('edit.propagate', propagate);
        let modelFallbacks = 0;
        try {
          const result = await runEditSession({
            source,
            documentId,
            prompt,
            models: buildModels(env, models, mode, () => modelFallbacks++),
            mode,
            typingAnimations,
            sleep,
            interpret,
            debug,
            propagate,
            runner: runInSandbox,
            signal,
          }).finally(presence.stop);
          span.setAttr(
            'edit.dispatch_count',
            result.session.dispatchEditTraces?.length ?? 0
          );
          span.setAttr('edit.ops_total', result.ops.length);
          span.setAttr('edit.blocked', result.clarification !== undefined);
          return result;
        } catch (err) {
          span.setAttr('edit.aborted', signal.aborted);
          span.error(err);
          throw err;
        } finally {
          span.setAttr('model.fallbacks', modelFallbacks);
        }
      }
    );

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
