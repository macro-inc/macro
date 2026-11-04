import type { AgentApiKeyProvider } from '@service-auth/generated/schemas/agentApiKeyProvider';

/** A provider an agent can bring its own key for. */
export type ApiKeyProvider = {
  id: AgentApiKeyProvider;
  name: string;
  /** The prefix every key the provider mints starts with. */
  prefix: string;
};

const PROVIDERS: readonly ApiKeyProvider[] = [
  { id: 'anthropic', name: 'Anthropic', prefix: 'sk-ant-' },
  { id: 'openai', name: 'OpenAI', prefix: 'sk-' },
];

/** The provider whose key can pay for a routed `provider/model` id. */
export function apiKeyProviderOf(model: string): ApiKeyProvider | undefined {
  const routed = model.split('/', 1)[0];
  return PROVIDERS.find((provider) => provider.id === routed);
}

export function apiKeyProviderName(provider: AgentApiKeyProvider): string {
  return PROVIDERS.find(({ id }) => id === provider)?.name ?? provider;
}
