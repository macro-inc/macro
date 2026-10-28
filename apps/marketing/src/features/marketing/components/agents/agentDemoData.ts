/** A representative local catalog, not a promise that every account has every model.
 * Verified against agent_inmem/domain/models.rs and the app picker at 40ceda68. */
export const AGENT_MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'gpt-5.6', label: 'GPT-5.6' },
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
];
export const AGENT_PLACEHOLDER = 'Message the agent, @mention anything';
