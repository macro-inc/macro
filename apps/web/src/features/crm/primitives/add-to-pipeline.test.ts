import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type {
  AddToPipelineSource,
  PipelineRowAdded,
} from '../context/pipelines';
import type { TrackedPipeline } from '../core/pipeline';
import {
  FIXTURE_REQUIREMENTS,
  fixtureColumns,
  fixtureEntry,
  fixturePipeline,
} from '../tests/add-to-pipeline-fixture';
import { createAddToPipeline } from './add-to-pipeline';

const sales = fixturePipeline('sales', 'Sales', 'company') as TrackedPipeline;
const columns = fixtureColumns('company');

function setup(outcome: PipelineRowAdded = { kind: 'added' }) {
  const addRow = vi.fn(async () => outcome);
  const source: AddToPipelineSource = {
    pipelines: () => [sales],
    loading: () => false,
    error: () => false,
    retry: async () => {},
    entries: () => [fixtureEntry(sales, 'row-1', 'Lead')],
    createSchema: () => ({
      columns: () => columns,
      requirements: () => FIXTURE_REQUIREMENTS,
      loading: () => false,
      error: () => false,
    }),
    addRow,
    cells: {},
  };
  const createSource = vi.fn(() => source);
  const feedback = { success: vi.fn(), failure: vi.fn() };
  const controller = createRoot(() =>
    createAddToPipeline({ createSource, feedback }, () => ({
      type: 'company',
      id: 'company-1',
      name: 'Northwind Ceramics',
      detail: 'northwind.example',
    }))
  );
  return { controller, createSource, addRow, feedback };
}

describe('createAddToPipeline', () => {
  it('reads nothing until the menu opens, then once', () => {
    const { controller, createSource } = setup();
    expect(createSource).not.toHaveBeenCalled();
    expect(controller.state()).toEqual({ kind: 'loading' });
    controller.load();
    controller.load();
    expect(createSource).toHaveBeenCalledTimes(1);
    expect(controller.state()).toMatchObject({
      kind: 'ready',
      choices: [{ stages: ['Lead'], state: 'available' }],
    });
  });

  it('adds at a stage that requires nothing and confirms it', async () => {
    const { controller, addRow, feedback } = setup();
    controller.load();
    await controller.chooseStage(sales, columns, FIXTURE_REQUIREMENTS, 'Lead');
    expect(addRow).toHaveBeenCalledWith(
      sales,
      columns,
      expect.objectContaining({
        values: { outcome: 'Open', stage: 'Lead', record: 'company-1' },
        open: false,
      })
    );
    expect(feedback.success).toHaveBeenCalledWith('Added to Sales at Lead');
    expect(controller.form()).toBeUndefined();
  });

  it('opens the form for a stage that requires fields', async () => {
    const { controller, addRow } = setup();
    controller.load();
    await controller.chooseStage(
      sales,
      columns,
      FIXTURE_REQUIREMENTS,
      'Proposal'
    );
    expect(addRow).not.toHaveBeenCalled();
    expect(controller.form()).toEqual({ pipeline: sales, stage: 'Proposal' });
  });

  it('reports a refused add and keeps the form open', async () => {
    const { controller, feedback } = setup({
      kind: 'failed',
      message: 'This property is read-only.',
    });
    controller.load();
    expect(
      await controller.addRow(sales, columns, { values: {}, open: false })
    ).toBe(false);
    expect(feedback.failure).toHaveBeenCalledWith(
      'This property is read-only.'
    );
  });

  it('warns instead of retrying when the answer was lost', async () => {
    const { controller, feedback } = setup({ kind: 'uncertain' });
    controller.load();
    expect(
      await controller.addRow(sales, columns, { values: {}, open: false })
    ).toBe(true);
    expect(feedback.success).not.toHaveBeenCalled();
    expect(feedback.failure).toHaveBeenCalledTimes(1);
  });
});
