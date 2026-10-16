import type { QuestionPlacement } from './form-layout';
import type { FormLayout, SectionKind } from './form-model';

/** A measured element, in viewport coordinates. */
export type Box = { top: number; bottom: number; left: number; right: number };

export type MeasuredSection = {
  id: string;
  kind: SectionKind;
  box: Box;
  /** Where its questions are listed; an empty section's drop zone. */
  list: Box;
  questions: { id: string; box: Box }[];
};

/** Where a dragged question would land, and where to draw the line. */
export type QuestionDrop = QuestionPlacement & { lineY: number };

export type SectionDrop = { index: number; lineY: number };

const middle = (box: Box) => (box.top + box.bottom) / 2;

function distance(y: number, box: Box) {
  if (y < box.top) return box.top - y;
  if (y > box.bottom) return y - box.bottom;
  return 0;
}

/** The line between two boxes, or beside the one that is there. */
function lineBetween(before: Box | undefined, after: Box | undefined) {
  if (before && after) return (before.bottom + after.top) / 2;
  if (after) return after.top - 4;
  if (before) return before.bottom + 4;
  return undefined;
}

/**
 * The slot under the pointer: in the questions section nearest it (gates take
 * no questions, so a pointer over one goes to the section above or below),
 * before the first other question whose middle is below the pointer.
 */
export function questionDropAt(
  pointerY: number,
  sections: readonly MeasuredSection[],
  draggedId: string
): QuestionDrop | undefined {
  let target: MeasuredSection | undefined;
  let nearest = Number.POSITIVE_INFINITY;
  for (const section of sections) {
    if (section.kind !== 'questions') continue;
    const gap = distance(pointerY, section.box);
    if (gap < nearest) {
      nearest = gap;
      target = section;
    }
  }
  if (!target) return undefined;
  const others = target.questions.filter((item) => item.id !== draggedId);
  const index = others.filter((item) => middle(item.box) < pointerY).length;
  const lineY =
    lineBetween(others[index - 1]?.box, others[index]?.box) ??
    middle(target.list);
  return { sectionId: target.id, index, lineY };
}

/** The line for a placement chosen by keyboard: where a pointer drop there would draw it. */
export function lineForPlacement(
  sections: readonly MeasuredSection[],
  draggedId: string,
  placement: QuestionPlacement
): number | undefined {
  const section = sections.find((item) => item.id === placement.sectionId);
  if (!section) return undefined;
  const others = section.questions.filter((item) => item.id !== draggedId);
  return (
    lineBetween(
      others[placement.index - 1]?.box,
      others[placement.index]?.box
    ) ?? middle(section.list)
  );
}

/** The line for a section placed at `index` among the others. */
export function lineForSectionIndex(
  sections: readonly { id: string; box: Box }[],
  draggedId: string,
  index: number
): number | undefined {
  const others = sections.filter((section) => section.id !== draggedId);
  return lineBetween(others[index - 1]?.box, others[index]?.box);
}

/** Where a dragged section would land among the others. */
export function sectionDropAt(
  pointerY: number,
  sections: readonly { id: string; box: Box }[],
  draggedId: string
): SectionDrop | undefined {
  const others = sections.filter((section) => section.id !== draggedId);
  if (others.length === 0) return undefined;
  const index = others.filter(
    (section) => middle(section.box) < pointerY
  ).length;
  const lineY = lineBetween(others[index - 1]?.box, others[index]?.box);
  if (lineY === undefined) return undefined;
  return { index, lineY };
}

/** A question's place: its section and index among the section's others. */
export function placementOf(
  layout: FormLayout,
  questionId: string
): QuestionPlacement | undefined {
  for (const section of layout.sections) {
    const index = section.questions.findIndex((item) => item.id === questionId);
    if (index >= 0) return { sectionId: section.id, index };
  }
  return undefined;
}

/**
 * One step up or down from `from`, crossing into the neighbouring questions
 * section (over any gate) at a section's edge. `undefined` at either end.
 */
export function stepPlacement(
  layout: FormLayout,
  questionId: string,
  from: QuestionPlacement,
  direction: 'up' | 'down'
): QuestionPlacement | undefined {
  const sections = layout.sections.map((section) => ({
    id: section.id,
    kind: section.kind,
    others: section.questions.filter((item) => item.id !== questionId).length,
  }));
  const at = sections.findIndex((section) => section.id === from.sectionId);
  if (at < 0) return undefined;
  if (direction === 'up') {
    if (from.index > 0)
      return { sectionId: from.sectionId, index: from.index - 1 };
    for (let index = at - 1; index >= 0; index--)
      if (sections[index].kind === 'questions')
        return { sectionId: sections[index].id, index: sections[index].others };
    return undefined;
  }
  if (from.index < sections[at].others)
    return { sectionId: from.sectionId, index: from.index + 1 };
  for (let index = at + 1; index < sections.length; index++)
    if (sections[index].kind === 'questions')
      return { sectionId: sections[index].id, index: 0 };
  return undefined;
}

export function samePlacement(
  left: QuestionPlacement | undefined,
  right: QuestionPlacement | undefined
) {
  return (
    !!left &&
    !!right &&
    left.sectionId === right.sectionId &&
    left.index === right.index
  );
}
