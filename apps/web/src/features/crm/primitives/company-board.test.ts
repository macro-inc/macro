import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createCompanyBoard } from './company-board';

describe('company board', () => {
  it('retains a newer drag when an earlier request fails, then accepts remote updates', () => {
    const [companies, setCompanies] = createSignal([
      { id: 'acme', stage: 'lead' },
    ]);
    const failures: (() => void)[] = [];
    const { board, dispose } = createRoot((dispose) => ({
      dispose,
      board: createCompanyBoard({
        companies,
        stages: () =>
          ['lead', 'active', 'closed'].map((id) => ({ id, label: id })),
        filterStages: () => [],
        selectedStages: () => [],
        noStageFilter: 'NO_STAGE',
        resolveStage: (company) => company.stage,
        canEdit: () => true,
        canMoveClosed: () => false,
        closedStages: () => new Set(['closed']),
        saveStage: (_id, _stage, failed) => failures.push(failed),
      }),
    }));
    board.moveToStage('acme', 'active');
    board.moveToStage('acme', 'closed');
    failures[0]();
    expect(board.effectiveStage(companies()[0])).toBe('closed');
    setCompanies([{ id: 'acme', stage: 'closed' }]);
    setCompanies([{ id: 'acme', stage: 'lead' }]);
    expect(board.effectiveStage(companies()[0])).toBe('lead');
    expect(board.canDragFrom('closed')).toBe(false);
    expect(board.canDragFrom('lead')).toBe(true);
    dispose();
  });
  it('shows selected legacy and no-stage columns in pipeline order', () => {
    const stages = [{ id: 'new', label: 'New' }];
    const legacy = { id: 'legacy', label: 'Legacy' };
    const saveStage = vi.fn();
    const { board, dispose } = createRoot((dispose) => ({
      dispose,
      board: createCompanyBoard({
        companies: () => [
          { id: 'a', stage: 'legacy' },
          { id: 'b', stage: undefined },
        ],
        stages: () => stages,
        filterStages: () => [...stages, legacy],
        selectedStages: () => ['NO_STAGE', 'legacy'],
        noStageFilter: 'NO_STAGE',
        resolveStage: (company) => company.stage,
        canEdit: () => false,
        canMoveClosed: () => true,
        closedStages: () => new Set<string>(),
        saveStage,
      }),
    }));
    expect(
      board
        .columns()
        .map((column) => [column.key, column.entities.map((e) => e.id)])
    ).toEqual([
      ['legacy', ['a']],
      ['', ['b']],
    ]);
    board.moveToStage('a', 'legacy');
    expect(saveStage).not.toHaveBeenCalled();
    expect(board.canDragFrom('')).toBe(false);
    dispose();
  });
});
