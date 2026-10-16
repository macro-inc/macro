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

  it('creates tasks as task documents', () => {
    const tasks = IMPORT_CATEGORIES.tasks;
    const jira = tasks.providers.find((p) => p.appSlug === 'jira')!;
    expect(agentImportHandoff(tasks, jira).instructions).toContain(
      'isTask true'
    );
  });
});

describe('import catalog', () => {
  it('gives every category unique providers led by a native source where one exists', () => {
    for (const config of Object.values(IMPORT_CATEGORIES)) {
      const slugs = config.providers.map((p) => p.appSlug);
      expect(new Set(slugs).size).toBe(slugs.length);
      const native = config.providers.findIndex((p) => p.native);
      expect(native === -1 || native === 0).toBe(true);
    }
  });
});
