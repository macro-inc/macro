import { match } from 'ts-pattern';
import type { LayoutRefusal } from './form-layout';
import type { FormLayout } from './form-model';

/** Names the builder shows for sections and columns. */
export type LayoutNames = {
  section: (sectionId: string) => string;
  column: (columnId: string) => string;
};

/**
 * A section's number as its card shows it: question sections and gates
 * count separately, from 1. 0 when the layout has no such section.
 */
export function sectionPosition(layout: FormLayout, sectionId: string): number {
  const section = layout.sections.find((item) => item.id === sectionId);
  if (!section) return 0;
  return (
    layout.sections
      .filter((item) => item.kind === section.kind)
      .findIndex((item) => item.id === sectionId) + 1
  );
}

/** A section's name as the outline shows it: its title, or its place. */
export function sectionName(layout: FormLayout, sectionId: string): string {
  const section = layout.sections.find((item) => item.id === sectionId);
  if (!section) return 'This section';
  if (section.title.trim()) return section.title.trim();
  const position = sectionPosition(layout, sectionId);
  return section.kind === 'gate' ? `Gate ${position}` : `Section ${position}`;
}

/** Where a questions section leads: the gates checked, then the next section or submit. */
export function routingLine(layout: FormLayout, sectionId: string): string {
  const index = layout.sections.findIndex((item) => item.id === sectionId);
  const later = layout.sections.slice(index + 1);
  const nextAt = later.findIndex((item) => item.kind === 'questions');
  const gates = (nextAt < 0 ? later : later.slice(0, nextAt)).filter(
    (item) => item.kind === 'gate'
  ).length;
  const check = gates === 1 ? 'Check gate' : `Check ${gates} gates`;
  if (nextAt < 0) return gates > 0 ? `${check}, then submit` : 'Submit form';
  const target = `section ${sectionPosition(layout, later[nextAt].id)}`;
  return gates > 0
    ? `${check}, then continue to ${target}`
    : `Continue to ${target}`;
}

/** Why a layout edit was refused, in the builder's words. */
export function layoutRefusalMessage(
  refusal: LayoutRefusal,
  names: LayoutNames
): string {
  return match(refusal)
    .with(
      { kind: 'gate-before-question' },
      ({ gateSectionId, columnId }) =>
        `“${names.section(gateSectionId)}” checks “${names.column(columnId)}”, so that question has to come before it.`
    )
    .with(
      { kind: 'gate-section' },
      () => 'A gate holds rules, not questions. Drop it in a section.'
    )
    .with(
      { kind: 'column-on-form' },
      ({ columnId }) => `“${names.column(columnId)}” is already on this form.`
    )
    .with(
      { kind: 'unknown-question' },
      () => 'That question is no longer on this form.'
    )
    .with(
      { kind: 'unknown-section' },
      () => 'That section is no longer on this form.'
    )
    .exhaustive();
}

/** Where a question lands, read aloud: "Section 2 (Details), position 1 of 3". */
export function placementDescription(
  layout: FormLayout,
  questionId: string,
  placement: { sectionId: string; index: number }
): string {
  const section = layout.sections.find(
    (item) => item.id === placement.sectionId && item.kind === 'questions'
  );
  if (!section) return '';
  const others = section.questions.filter(
    (question) => question.id !== questionId
  ).length;
  const title = section.title.trim();
  return `Section ${sectionPosition(layout, section.id)}${title ? ` (${title})` : ''}, position ${placement.index + 1} of ${others + 1}`;
}
