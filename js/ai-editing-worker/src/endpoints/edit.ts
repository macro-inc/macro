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
import {
  fetchDocToken,
  makeSearchContacts,
  makeSearchDocuments,
} from '../service-clients';

type Provider = 'anthropic' | 'cerebras' | 'openai';

const PROVIDERS = {
  anthropic: {
    key: 'ANTHROPIC_API_KEY' as const,
    defaultModel: 'claude-sonnet-4-6',
    create: createAnthropic,
  },
  cerebras: {
    key: 'CEREBRAS_API_KEY' as const,
    defaultModel: 'gpt-oss-120b',
    create: createCerebras,
  },
  openai: {
    key: 'OPENAI_API_KEY' as const,
    defaultModel: 'gpt-4o',
    create: createOpenAI,
  },
} satisfies Record<
  Provider,
  {
    key: keyof Bindings;
    defaultModel: string;
    create: (opts: { apiKey: string }) => (modelId: string) => LanguageModel;
  }
>;

const DEFAULT_PROVIDER = 'anthropic' satisfies Provider;

const ModelSchema: z.ZodType<Model> = z.object({
  provider: z.enum(['anthropic', 'cerebras', 'openai']),
  model: z.string(),
});

const DEFAULT_MODELS = {
  supervisor: {
    provider: 'anthropic' satisfies Provider,
    model: 'claude-haiku-4-5-20251001',
  },
  interpret: {
    provider: 'anthropic' satisfies Provider,
    model: 'claude-sonnet-4-6',
  },
  coding: {
    provider: 'cerebras' satisfies Provider,
    model: PROVIDERS.cerebras.defaultModel,
  },
} satisfies Record<string, Model>;

const EditBody = z.object({
  userToken: z.string(),
  documentId: z.string(),
  prompt: z.string(),
  models: z
    .object({
      supervisor: ModelSchema.optional(),
      interpret: ModelSchema.optional(),
      coding: ModelSchema.optional(),
    })
    .optional(),
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
    models: modelsSpec,
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

    const { usage, ops, trace } = await runEditSession({
      wsUrl,
      documentId,
      prompt,
      models: {
        supervisor: resolveModel(
          modelsSpec?.supervisor ?? DEFAULT_MODELS.supervisor
        ),
        interpret: resolveModel(
          modelsSpec?.interpret ?? DEFAULT_MODELS.interpret
        ),
        coding: resolveModel(modelsSpec?.coding ?? DEFAULT_MODELS.coding),
      },
      typingAnimations,
      interpret,
      debug,
      runner: runInSandbox,
      signal,
      searchContacts: makeSearchContacts(
        env.CONTACTS_SERVICE_BASE,
        env.AUTH_SERVICE_BASE,
        userToken
      ),
      searchDocuments: makeSearchDocuments(env.SEARCH_SERVICE_BASE, userToken),
    });
    return c.json({ ok: true, usage, ops, trace });
  } catch (err) {
    if (!(err instanceof Error)) throw new Error(String(err));
    // 499 is non-standard (client closed request); cast past Hono's status union
    const status = (signal.aborted ? 499 : 502) as 502;
    return c.json({ error: err.message }, status);
  }
});

export default edit;
