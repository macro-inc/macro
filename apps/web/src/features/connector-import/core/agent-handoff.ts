import { match } from 'ts-pattern';
import type { ImportCategoryConfig, ImportProvider } from './providers';

/** What the agent chat that runs an import opens with. */
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

/** Ledger bookkeeping, so neither the user nor a teammate imports twice. */
function ledgerSteps(provider: ImportProvider): string[] {
  if (!provider.ledger) return [];
  return [
    `Check ListImportEntities for source ${provider.ledger} first and leave out anything already imported or declined.`,
    `After creating each item, record it with CreateImportEntity: source ${provider.ledger}, status imported, and the new entityId.`,
  ];
}

/**
 * Notion runs Macro's workspace importer: the agent asks who should see the
 * import, plans it with ImportFromNotion, and presents the plan for review.
 */
const NOTION_WORKSPACE_HANDOFF: AgentImportHandoff = {
  input: 'Import my Notion workspace into Macro.',
  instructions: [
    "The user started this from Macro's import dialog and has just connected Notion.",
    'Import their workspace with ImportFromNotion: ask who should see it if the tool says to, plan it, and present the plan for review right away.',
    'Never recreate Notion pages with CreateDocument or ImportNotionPage, and never edit or delete anything in Notion.',
  ].join(' '),
};

export function agentImportHandoff(
  config: ImportCategoryConfig,
  provider: ImportProvider
): AgentImportHandoff {
  if (provider.ledger === 'notion') return NOTION_WORKSPACE_HANDOFF;
  if (provider.ledger === 'linear' || provider.ledger === 'jira') {
    return {
      input: `Import my ${provider.name} workspace into Macro.`,
      instructions: [
        `The user started this from Macro's import dialog and has just connected ${provider.name}.`,
        `Use ImportFrom${provider.name} to plan their workspace, ask who should see it if required, and present the import review right away.`,
        `Never recreate plan items with other tools, and never edit or delete anything in ${provider.name}.`,
      ].join(' '),
    };
  }
  return {
    input: `Import my most recent ${config.items} from ${provider.name} into ${config.destination}.`,
    instructions: [
      `The user started this from Macro's import dialog and has just connected ${provider.name}.`,
      `Use the ${provider.name} connector tools to find their most relevant recent ${config.items}.`,
      ...ledgerSteps(provider),
      `Before creating anything, show a short numbered list and ask which ones to bring over.`,
      createWith(config),
      `Only read from ${provider.name}; never edit or delete anything there.`,
      'Finish with links to everything you created.',
    ].join(' '),
  };
}
