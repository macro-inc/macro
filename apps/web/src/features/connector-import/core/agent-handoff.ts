import { match } from 'ts-pattern';
import type { ImportCategoryConfig, ImportProvider } from './providers';

/** What an agent chat opens with when a provider has no native importer. */
export type AgentImportHandoff = {
  /** Unsent composer text the user can adjust before sending. */
  input: string;
  /** Private guidance for the agent; never shown in the transcript. */
  instructions: string;
};

function createWith(config: ImportCategoryConfig): string {
  return match(config.category)
    .with(
      'files',
      () =>
        'Create each document with CreateDocument, converting its content to markdown. Keep the original title.'
    )
    .with(
      'tasks',
      () =>
        'Create each one with CreateDocument and isTask true. Keep the title, put the description in the body, and set status, assignee, and due date with SetEntityProperty when the source has them.'
    )
    .with(
      'crm',
      () =>
        'Check ListCompanies first so nothing is duplicated, then use CreateCompany and CreateContact. Set stage, owner, and other properties with SetEntityProperty when the source has them.'
    )
    .with(
      'channels',
      () =>
        'Create each channel with CreateChannel, keeping its name and purpose.'
    )
    .exhaustive();
}

export function agentImportHandoff(
  config: ImportCategoryConfig,
  provider: ImportProvider
): AgentImportHandoff {
  return {
    input: `Import my most recent ${config.items} from ${provider.name} into ${config.destination}.`,
    instructions: [
      `The user started this from Macro's import dialog and has just connected ${provider.name}.`,
      `Use the ${provider.name} connector tools to find their most relevant recent ${config.items}.`,
      `Before creating anything, show a short numbered list and ask which ones to bring over.`,
      createWith(config),
      `Only read from ${provider.name}; never edit or delete anything there.`,
      'Finish with links to everything you created.',
    ].join(' '),
  };
}
