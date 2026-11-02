import { describe, expect, it } from 'vitest';
import { agentImportHandoff } from './agent-handoff';
import { IMPORT_CATEGORIES } from './catalog';

describe('agent import handoff', () => {
  it('asks before creating and never writes back to the source', () => {
    const crm = IMPORT_CATEGORIES.crm;
    const hubspot = crm.providers.find((p) => p.appSlug === 'hubspot')!;
    const handoff = agentImportHandoff(crm, hubspot);
    expect(handoff.input).toBe(
      'Import my most recent companies and contacts from HubSpot into the Macro CRM.'
    );
    expect(handoff.instructions).toContain('ask which ones to bring over');
    expect(handoff.instructions).toContain('CreateCompany');
    expect(handoff.instructions).toContain('never edit or delete');
  });

  it("imports the Notion workspace through Macro's importer", () => {
    const files = IMPORT_CATEGORIES.files;
    const notion = files.providers.find((p) => p.appSlug === 'notion')!;
    const handoff = agentImportHandoff(files, notion);
    expect(handoff.input).toBe('Import my Notion workspace into Macro.');
    expect(handoff.instructions).toContain('ImportFromNotion');
    expect(handoff.instructions).not.toContain('CreateImportEntity');
  });

  it('uses the reviewed Linear importer', () => {
    const tasks = IMPORT_CATEGORIES.tasks;
    const linear = tasks.providers.find((p) => p.appSlug === 'linear')!;
    const { instructions } = agentImportHandoff(tasks, linear);
    expect(instructions).toContain('ImportFromLinear');
    expect(instructions).not.toContain('CreateImportEntity');
  });

  it('uses the reviewed Jira importer', () => {
    const tasks = IMPORT_CATEGORIES.tasks;
    const jira = tasks.providers.find((p) => p.appSlug === 'jira')!;
    expect(agentImportHandoff(tasks, jira).instructions).toContain(
      'ImportFromJira'
    );
  });
});

describe('import catalog', () => {
  it('gives every category unique providers led by a ledger source where one exists', () => {
    for (const config of Object.values(IMPORT_CATEGORIES)) {
      const slugs = config.providers.map((p) => p.appSlug);
      expect(new Set(slugs).size).toBe(slugs.length);
      const ledger = config.providers.findIndex((p) => p.ledger);
      expect(ledger === -1 || ledger === 0).toBe(true);
    }
  });
});
