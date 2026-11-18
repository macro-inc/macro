import { describe, expect, it } from 'vitest';
import {
  FIXTURE_REQUIREMENTS,
  fixtureColumns,
  fixtureEntry,
  fixturePipeline,
} from '../tests/add-to-pipeline-fixture';
import {
  pipelineChoices,
  stageAddition,
  stageColumn,
  startingValues,
} from './add-to-pipeline';

const sales = fixturePipeline('sales', 'Sales', 'company');
const renewals = fixturePipeline('renewals', 'Renewals', 'company', {
  grant: 'comment',
});
const partners = fixturePipeline('partners', 'Partners', 'company', {
  grant: 'view',
});
const hiring = fixturePipeline('hiring', 'Hiring', 'contact');
const generic = fixturePipeline('ideas', 'Ideas', null);
const trashed = fixturePipeline('old', 'Old deals', 'company', {
  trashedAt: '2026-02-01T00:00:00Z',
});

describe('pipelineChoices', () => {
  const all = [sales, renewals, partners, hiring, generic, trashed];

  it('offers only live pipelines of the record type, by name', () => {
    expect(
      pipelineChoices(all, 'company', []).map((choice) => choice.pipeline.id)
    ).toEqual(['partners', 'renewals', 'sales']);
    expect(
      pipelineChoices(all, 'contact', []).map((choice) => choice.pipeline.id)
    ).toEqual(['hiring']);
  });

  it('disables pipelines the viewer can only view or comment on', () => {
    const states = Object.fromEntries(
      pipelineChoices(all, 'company', []).map((choice) => [
        choice.pipeline.id,
        choice.state,
      ])
    );
    expect(states).toEqual({
      partners: 'view-only',
      renewals: 'view-only',
      sales: 'available',
    });
  });

  it('refuses a contact pipeline it was just added to before its rows show', () => {
    const [choice] = pipelineChoices([hiring], 'contact', [], ['hiring']);
    expect(choice).toMatchObject({ inPipeline: true, state: 'already-in' });
  });

  it("marks a company's deals and still lets it add another", () => {
    const [choice] = pipelineChoices([sales], 'company', [
      fixtureEntry(sales, 'row-1', 'Lead'),
      fixtureEntry(sales, 'row-2', 'Proposal'),
    ]);
    expect(choice).toMatchObject({
      inPipeline: true,
      stages: ['Lead', 'Proposal'],
      state: 'available',
    });
  });

  it('refuses a contact already in the pipeline', () => {
    const [choice] = pipelineChoices([hiring], 'contact', [
      fixtureEntry(hiring, 'row-1', 'Qualified'),
    ]);
    expect(choice).toMatchObject({
      inPipeline: true,
      stages: ['Qualified'],
      state: 'already-in',
    });
  });

  it('reads the stage from the Stage column, not Outcome', () => {
    const [choice] = pipelineChoices([sales], 'company', [
      fixtureEntry(sales, 'row-1', ''),
    ]);
    expect(choice.stages).toEqual([]);
  });
});

describe('stageColumn', () => {
  it('prefers the column named Stage and skips fixed system columns', () => {
    expect(stageColumn(fixtureColumns('company'))?.id).toBe('stage');
    const renamed = fixtureColumns('company').map((column) =>
      column.id === 'stage' ? { ...column, name: 'Milestone' } : column
    );
    expect(stageColumn(renamed)?.id).toBe('stage');
  });
});

describe('startingValues', () => {
  it('starts from column defaults, then the given values', () => {
    expect(
      startingValues(fixtureColumns('company'), { stage: 'Lead' })
    ).toEqual({ outcome: 'Open', stage: 'Lead' });
  });
});

describe('stageAddition', () => {
  const columns = fixtureColumns('company');

  it('adds at once when the stage requires nothing', () => {
    expect(
      stageAddition(columns, FIXTURE_REQUIREMENTS, 'company-1', 'Lead')
    ).toEqual({
      kind: 'add',
      values: { outcome: 'Open', stage: 'Lead', record: 'company-1' },
    });
  });

  it('opens the form at the stage when it requires fields', () => {
    expect(
      stageAddition(columns, FIXTURE_REQUIREMENTS, 'company-1', 'Proposal')
    ).toEqual({ kind: 'form', initialValues: { stage: 'Proposal' } });
  });
});
