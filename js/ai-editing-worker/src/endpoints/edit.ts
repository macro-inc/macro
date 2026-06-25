import { createAnthropic } from '@ai-sdk/anthropic';
import { createCerebras } from '@ai-sdk/cerebras';
import { createOpenAI } from '@ai-sdk/openai';
import { zValidator } from '@hono/zod-validator';
import type { LanguageModel } from 'ai';
import { Hono } from 'hono';
import * as z from 'zod';
import type { Bindings, EnvVariables } from '../env';
import { type Model, runEditSession } from '../run-edit';
import { runInSandbox } from '../sandbox';
import { fetchDocToken } from '../service-clients';

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

const EditBody = z.object({
  userToken: z.string(),
  documentId: z.string(),
  prompt: z.string(),
  models: z.object({
    supervisor: ModelSchema,
    interpret: ModelSchema,
    coding: ModelSchema,
  }),
  typingAnimations: z.boolean().optional(),
  interpret: z.boolean().default(true),
  debug: z.boolean().default(false),
});

const edit = new Hono<{ Bindings: Bindings; Variables: EnvVariables }>();

edit.post('/', zValidator('json', EditBody), async (c) => {
  const env = c.var.env;
  const {
    userToken,
    documentId,
    prompt,
    models,
    typingAnimations,
    interpret,
    debug,
  } = c.req.valid('json');

  const resolveModel = ({ provider, model }: Model): LanguageModel => {
    const apiKey = env[PROVIDERS[provider].key];
    return PROVIDERS[provider].create({ apiKey })(model);
  };

  const signal = c.req.raw.signal;

  try {
    const docToken = await fetchDocToken(env.DSS_BASE, documentId, userToken);
    const wsUrl = `${env.SYNC_WS_BASE}/document/${documentId}/connect?token=${docToken}`;

    const { usage, ops, trace, clarification } = await runEditSession({
      wsUrl,
      documentId,
      prompt,
      models: {
        supervisor: resolveModel(models.supervisor),
        interpret: resolveModel(models.interpret),
        coding: resolveModel(models.coding),
      },
      typingAnimations,
      interpret,
      debug,
      runner: runInSandbox,
      signal,
    });
    return c.json({ ok: true, usage, ops, trace, clarification });
  } catch (err) {
    if (!(err instanceof Error)) throw new Error(String(err));
    const status = (signal.aborted ? 499 : 502) as 502;
    return c.json({ error: err.message }, status);
  }
});

export default edit;
