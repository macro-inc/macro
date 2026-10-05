import { err, ok, type Result } from 'neverthrow';
import type {
  FormColumn,
  FormLayout,
  FormQuestion,
  FormSection,
  GateNode,
  GateRules,
} from './form-model';

/** Where a question lands: its index among the section's other questions. */
export type QuestionPlacement = { sectionId: string; index: number };

/** Why a layout edit was refused; nothing changed. */
export type LayoutRefusal =
  | { kind: 'unknown-question'; questionId: string }
  | { kind: 'unknown-section'; sectionId: string }
  | { kind: 'gate-section'; sectionId: string }
  | { kind: 'column-on-form'; columnId: string }
  | {
      kind: 'gate-before-question';
      gateSectionId: string;
      columnId: string;
    };

export type QuestionPatch = Partial<
  Pick<FormQuestion, 'helpText' | 'required' | 'widget'>
>;

export type SectionPatch = Partial<
  Pick<FormSection, 'title' | 'description' | 'gateRules' | 'gateMessage'>
>;

/** A layout edit that also dropped gate conditions naming columns it took off the form. */
export type PrunedLayout = { layout: FormLayout; prunedConditions: number };

function clamp(index: number, length: number) {
  return Math.max(0, Math.min(index, length));
}

function insertAt<Item>(items: readonly Item[], index: number, item: Item) {
  const next = [...items];
  next.splice(clamp(index, items.length), 0, item);
  return next;
}

function findQuestion(layout: FormLayout, questionId: string) {
  for (const section of layout.sections) {
    const question = section.questions.find((item) => item.id === questionId);
    if (question) return { section, question };
  }
  return undefined;
}

function questionsSection(
  layout: FormLayout,
  sectionId: string
): Result<FormSection, LayoutRefusal> {
  const section = layout.sections.find((item) => item.id === sectionId);
  if (!section) return err({ kind: 'unknown-section', sectionId });
  if (section.kind === 'gate') return err({ kind: 'gate-section', sectionId });
  return ok(section);
}

function columnOnForm(layout: FormLayout, columnId: string) {
  return layout.sections.some((section) =>
    section.questions.some((question) => question.columnId === columnId)
  );
}

function replaceSection(
  layout: FormLayout,
  sectionId: string,
  change: (section: FormSection) => FormSection
): FormLayout {
  return {
    sections: layout.sections.map((section) =>
      section.id === sectionId ? change(section) : section
    ),
  };
}

/** The layout, or the first gate that names a column not asked before it. */
function checkedGates(layout: FormLayout): Result<FormLayout, LayoutRefusal> {
  for (const section of layout.sections) {
    if (section.kind !== 'gate' || !section.gateRules) continue;
    const allowed = new Set(gateColumns(layout, section.id));
    const outside = columnsNamed(section.gateRules).find(
      (columnId) => !allowed.has(columnId)
    );
    if (outside)
      return err({
        kind: 'gate-before-question',
        gateSectionId: section.id,
        columnId: outside,
      });
  }
  return ok(layout);
}

/** Rules without the conditions naming `columns`, and how many went. */
function pruneRules(
  rules: GateRules,
  columns: ReadonlySet<string>
): { rules: GateRules; pruned: number } {
  let pruned = 0;
  const conditions = rules.conditions.flatMap((node): GateNode[] => {
    if (node.kind === 'group') {
      const inner = pruneRules(node, columns);
      pruned += inner.pruned;
      // An empty group passes, so a group emptied by pruning goes with its
      // conditions rather than letting an OR around it pass everyone.
      if (inner.pruned > 0 && inner.rules.conditions.length === 0) return [];
      return [{ kind: 'group', ...inner.rules }];
    }
    if (columns.has(node.column)) {
      pruned += 1;
      return [];
    }
    return [node];
  });
  return { rules: { conjunction: rules.conjunction, conditions }, pruned };
}

function pruneGates(
  layout: FormLayout,
  columns: ReadonlySet<string>
): PrunedLayout {
  let prunedConditions = 0;
  const sections = layout.sections.map((section) => {
    if (!section.gateRules) return section;
    const { rules, pruned } = pruneRules(section.gateRules, columns);
    prunedConditions += pruned;
    return pruned > 0 ? { ...section, gateRules: rules } : section;
  });
  return { layout: { sections }, prunedConditions };
}

export function addQuestion(
  layout: FormLayout,
  question: FormQuestion,
  placement: QuestionPlacement
): Result<FormLayout, LayoutRefusal> {
  if (columnOnForm(layout, question.columnId))
    return err({ kind: 'column-on-form', columnId: question.columnId });
  return questionsSection(layout, placement.sectionId).map((target) =>
    replaceSection(layout, target.id, (section) => ({
      ...section,
      questions: insertAt(section.questions, placement.index, question),
    }))
  );
}

export function moveQuestion(
  layout: FormLayout,
  questionId: string,
  placement: QuestionPlacement
): Result<FormLayout, LayoutRefusal> {
  const found = findQuestion(layout, questionId);
  if (!found) return err({ kind: 'unknown-question', questionId });
  return questionsSection(layout, placement.sectionId).andThen((target) => {
    const sections = layout.sections.map((section) => {
      const others = section.questions.filter((item) => item.id !== questionId);
      if (section.id === target.id)
        return {
          ...section,
          questions: insertAt(others, placement.index, found.question),
        };
      return others.length === section.questions.length
        ? section
        : { ...section, questions: others };
    });
    return checkedGates({ sections });
  });
}

export function removeQuestion(
  layout: FormLayout,
  questionId: string
): Result<PrunedLayout, LayoutRefusal> {
  const found = findQuestion(layout, questionId);
  if (!found) return err({ kind: 'unknown-question', questionId });
  const without = replaceSection(layout, found.section.id, (section) => ({
    ...section,
    questions: section.questions.filter((item) => item.id !== questionId),
  }));
  return ok(pruneGates(without, new Set([found.question.columnId])));
}

export function updateQuestion(
  layout: FormLayout,
  questionId: string,
  patch: QuestionPatch
): Result<FormLayout, LayoutRefusal> {
  const found = findQuestion(layout, questionId);
  if (!found) return err({ kind: 'unknown-question', questionId });
  return ok(
    replaceSection(layout, found.section.id, (section) => ({
      ...section,
      questions: section.questions.map((item) =>
        item.id === questionId ? { ...item, ...patch } : item
      ),
    }))
  );
}

export function swapQuestionColumn(
  layout: FormLayout,
  questionId: string,
  columnId: string
): Result<PrunedLayout, LayoutRefusal> {
  const found = findQuestion(layout, questionId);
  if (!found) return err({ kind: 'unknown-question', questionId });
  if (columnOnForm(layout, columnId))
    return err({ kind: 'column-on-form', columnId });
  const swapped = replaceSection(layout, found.section.id, (section) => ({
    ...section,
    questions: section.questions.map((item) =>
      item.id === questionId ? { ...item, columnId } : item
    ),
  }));
  return ok(pruneGates(swapped, new Set([found.question.columnId])));
}

export function addSection(
  layout: FormLayout,
  section: FormSection,
  index: number
): Result<FormLayout, LayoutRefusal> {
  return checkedGates({
    sections: insertAt(layout.sections, index, section),
  });
}

export function moveSection(
  layout: FormLayout,
  sectionId: string,
  index: number
): Result<FormLayout, LayoutRefusal> {
  const section = layout.sections.find((item) => item.id === sectionId);
  if (!section) return err({ kind: 'unknown-section', sectionId });
  const others = layout.sections.filter((item) => item.id !== sectionId);
  return checkedGates({ sections: insertAt(others, index, section) });
}

export function removeSection(
  layout: FormLayout,
  sectionId: string
): Result<PrunedLayout, LayoutRefusal> {
  const section = layout.sections.find((item) => item.id === sectionId);
  if (!section) return err({ kind: 'unknown-section', sectionId });
  return ok(
    pruneGates(
      { sections: layout.sections.filter((item) => item.id !== sectionId) },
      new Set(section.questions.map((question) => question.columnId))
    )
  );
}

export function updateSection(
  layout: FormLayout,
  sectionId: string,
  patch: SectionPatch
): Result<FormLayout, LayoutRefusal> {
  if (!layout.sections.some((item) => item.id === sectionId))
    return err({ kind: 'unknown-section', sectionId });
  return checkedGates(
    replaceSection(layout, sectionId, (section) => ({ ...section, ...patch }))
  );
}

/** Each question's number, counting through every section in order from 1. */
export function questionNumbers(layout: FormLayout): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const section of layout.sections)
    for (const question of section.questions)
      numbers.set(question.id, numbers.size + 1);
  return numbers;
}

/** Columns a gate may test: questions of the questions sections before it. */
export function gateColumns(layout: FormLayout, sectionId: string): string[] {
  const index = layout.sections.findIndex((item) => item.id === sectionId);
  if (index < 0) return [];
  return layout.sections
    .slice(0, index)
    .filter((section) => section.kind === 'questions')
    .flatMap((section) =>
      section.questions.map((question) => question.columnId)
    );
}

/**
 * Columns a gate's rules test that no earlier question asks: the question
 * went in the grid (its column deleted or retyped) and the rule stayed.
 */
export function brokenGateColumns(
  layout: FormLayout,
  sectionId: string
): string[] {
  const section = layout.sections.find((item) => item.id === sectionId);
  if (!section?.gateRules) return [];
  const asked = new Set(gateColumns(layout, sectionId));
  return columnsNamed(section.gateRules).filter((column) => !asked.has(column));
}

/** The gate without its broken rules (see `brokenGateColumns`). */
export function pruneBrokenRules(
  layout: FormLayout,
  sectionId: string
): Result<PrunedLayout, LayoutRefusal> {
  const section = layout.sections.find((item) => item.id === sectionId);
  if (!section) return err({ kind: 'unknown-section', sectionId });
  if (!section.gateRules) return ok({ layout, prunedConditions: 0 });
  const { rules, pruned } = pruneRules(
    section.gateRules,
    new Set(brokenGateColumns(layout, sectionId))
  );
  return ok({
    layout: replaceSection(layout, sectionId, (item) => ({
      ...item,
      gateRules: rules,
    })),
    prunedConditions: pruned,
  });
}

/** Columns that a gate's rules name, in order of first mention. */
export function columnsNamed(rules: GateRules): string[] {
  const named = rules.conditions.flatMap((node) =>
    node.kind === 'group' ? columnsNamed(node) : [node.column]
  );
  return [...new Set(named)];
}

/** The table's columns no question asks, less the ones the form writes itself. */
export function hiddenColumns(
  layout: FormLayout,
  columns: readonly FormColumn[],
  managedColumnIds: readonly (string | null)[]
): FormColumn[] {
  const managed = new Set(managedColumnIds);
  return columns.filter(
    (column) => !managed.has(column.id) && !columnOnForm(layout, column.id)
  );
}
