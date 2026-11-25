import { join } from 'node:path';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import {
  createAgentSession,
  createExtensionRuntime,
  defineTool,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

export const toolName = 'read_fixture_record';

export type DispatchFakeTool = (
  record: string,
  signal: AbortSignal | undefined
) => Promise<string>;

export const openOfflineSession = async (
  root: string,
  systemPrompt: string,
  dispatch: DispatchFakeTool
) => {
  const cwd = join(root, 'project');
  const agentDir = join(root, 'agent');
  const faux = fauxProvider({ tokenSize: { min: 1, max: 1 } });
  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });

  const extensions = {
    extensions: [],
    errors: [],
    runtime: createExtensionRuntime(),
  };
  const resourceLoader: ResourceLoader = {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };

  const result = await createAgentSession({
    cwd,
    agentDir,
    modelRuntime,
    model: faux.getModel(),
    thinkingLevel: 'off',
    resourceLoader,
    sessionManager: SessionManager.inMemory(cwd),
    settingsManager: SettingsManager.inMemory({
      cacheWarming: 'off',
      compaction: { enabled: false },
      retry: { enabled: false },
    }),
    noTools: 'all',
    tools: [toolName],
    customTools: [
      defineTool({
        name: toolName,
        label: 'Read fixture record',
        description: 'Read the synthetic record through the parent stand-in.',
        parameters: Type.Object({ record: Type.String() }),
        execute: async (_toolCallId, { record }, signal) => ({
          content: [{ type: 'text', text: await dispatch(record, signal) }],
          details: {},
        }),
      }),
    ],
  });

  const installFakeProvider = () => {
    modelRuntime.registerNativeProvider(faux.provider);
    return faux;
  };

  return { ...result, installFakeProvider };
};
