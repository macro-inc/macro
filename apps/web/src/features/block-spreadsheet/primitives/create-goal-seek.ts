import {
  type GoalSeekRequest,
  type GoalSeekResult,
  type GoalSeekSolution,
  parseGoalSeekReference,
  parseGoalValue,
} from '@macro-inc/spreadsheet/goal-seek';
import type { Accessor } from 'solid-js';
import { createSignal } from 'solid-js';
import type { SpreadsheetCell } from '../core/spreadsheet-document';

export type GoalSeekSheet = { id: string; name: string };

export function resolveGoalSeekReference(
  text: string,
  sheets: GoalSeekSheet[],
  activeSheetId: string
): { sheetId: string; address: string } | { message: string } {
  const parsed = parseGoalSeekReference(text);
  if (!parsed) return { message: 'Enter a cell such as B12 or Inputs!B12.' };
  if (!parsed.sheet) return { sheetId: activeSheetId, address: parsed.address };
  const sheet = sheets.find(
    (entry) => entry.name.toLowerCase() === parsed.sheet?.toLowerCase()
  );
  if (!sheet) return { message: `There is no sheet named ${parsed.sheet}.` };
  return { sheetId: sheet.id, address: parsed.address };
}

function isFormula(cell: SpreadsheetCell | undefined) {
  return !!cell && cell.format !== 'text' && cell.value.startsWith('=');
}

export function createGoalSeek(source: {
  sheets: Accessor<GoalSeekSheet[]>;
  activeSheetId: Accessor<string>;
  activeAddress: Accessor<string>;
  cell: (sheetId: string, address: string) => SpreadsheetCell | undefined;
  canEdit: Accessor<boolean>;
  revision: Accessor<number>;
  seek: (request: GoalSeekRequest) => Promise<GoalSeekResult>;
  apply: (
    sheetId: string,
    address: string,
    value: string
  ) => string | undefined;
  select: (sheetId: string, address: string) => void;
}) {
  const [open, setOpen] = createSignal(false);
  const [setCell, setSetCell] = createSignal('');
  const [goal, setGoal] = createSignal('');
  const [changingCell, setChangingCell] = createSignal('');
  const [message, setMessage] = createSignal('');
  const [seeking, setSeeking] = createSignal(false);
  const [solution, setSolution] = createSignal<GoalSeekSolution>();
  let operation = 0;
  let solvedRevision = 0;

  function show() {
    if (!source.canEdit()) return;
    const sheetId = source.activeSheetId();
    const address = source.activeAddress();
    const formula = isFormula(source.cell(sheetId, address));
    operation++;
    setSetCell(formula ? address : '');
    setChangingCell(formula ? '' : address);
    setGoal('');
    setMessage('');
    setSolution(undefined);
    setSeeking(false);
    setOpen(true);
  }

  function close() {
    operation++;
    setSeeking(false);
    setOpen(false);
  }

  function request(): GoalSeekRequest | undefined {
    const setTarget = resolveGoalSeekReference(
      setCell(),
      source.sheets(),
      source.activeSheetId()
    );
    if ('message' in setTarget) {
      setMessage(setTarget.message);
      return;
    }
    const goalValue = parseGoalValue(goal());
    if (goalValue === undefined) {
      setMessage('Enter the value the formula should reach.');
      return;
    }
    const changeTarget = resolveGoalSeekReference(
      changingCell(),
      source.sheets(),
      source.activeSheetId()
    );
    if ('message' in changeTarget) {
      setMessage(changeTarget.message);
      return;
    }
    if (
      setTarget.sheetId === changeTarget.sheetId &&
      setTarget.address === changeTarget.address
    ) {
      setMessage('Set cell and the changing cell have to be different cells.');
      return;
    }
    setMessage('');
    return {
      setSheetId: setTarget.sheetId,
      setAddress: setTarget.address,
      goal: goalValue,
      changeSheetId: changeTarget.sheetId,
      changeAddress: changeTarget.address,
    };
  }

  async function seek() {
    const next = request();
    if (!next) return;
    const current = ++operation;
    const revision = source.revision();
    setSolution(undefined);
    setSeeking(true);
    setMessage('');
    try {
      const result = await source.seek(next);
      if (current !== operation) return;
      if (source.revision() !== revision) {
        setMessage('The sheet changed while Goal Seek was running. Try again.');
        return;
      }
      if (result.status === 'invalid') {
        setMessage(result.message);
        return;
      }
      solvedRevision = revision;
      setSolution(result);
    } catch (error) {
      if (current !== operation) return;
      setMessage(error instanceof Error ? error.message : 'Goal Seek failed.');
    } finally {
      if (current === operation) setSeeking(false);
    }
  }

  function apply() {
    const found = solution();
    if (!found) return;
    if (source.revision() !== solvedRevision) {
      setSolution(undefined);
      setMessage('The sheet changed while Goal Seek was running. Try again.');
      return;
    }
    const rejected = source.apply(
      found.changeSheetId,
      found.changeAddress,
      found.input
    );
    if (rejected) {
      setMessage(rejected);
      return;
    }
    source.select(found.changeSheetId, found.changeAddress);
    close();
  }

  return {
    open,
    setCell,
    setSetCell,
    goal,
    setGoal,
    changingCell,
    setChangingCell,
    message,
    seeking,
    solution,
    show,
    close,
    seek,
    apply,
    clearSolution: () => {
      setSolution(undefined);
      setMessage('');
    },
  };
}
