import { match } from 'ts-pattern';
import type { LayoutRefusal } from './form-layout';
import type { FormLayout, FormSection } from './form-model';

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
  return match(section.kind)
    .with('questions', () => `Section ${position}`)
    .with('gate', () => `Gate ${position}`)
    .with('booking', () => 'Booking')
    .exhaustive();
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
  if (nextAt < 0) {
    const booking = later.some((item) => item.kind === 'booking');
    if (gates > 0)
      return booking
        ? `${check}, then submit and book a time`
        : `${check}, then submit`;
    return booking ? 'Submit, then book a time' : 'Submit form';
  }
  const next = later[nextAt];
  const target = `section ${sectionPosition(layout, next.id)}`;
  const line =
    gates > 0
      ? `${check}, then continue to ${target}`
      : `Continue to ${target}`;
  return next.showWhen
    ? `${line}, or ${skipLine(layout, later.slice(nextAt + 1))}`
    : line;
}

/** Where a respondent goes past a skipped section, when one step says it; else "skip ahead". */
function skipLine(layout: FormLayout, later: readonly FormSection[]): string {
  const nextAt = later.findIndex((item) => item.kind === 'questions');
  const between = nextAt < 0 ? later : later.slice(0, nextAt);
  if (between.some((item) => item.kind === 'gate')) return 'skip ahead';
  if (nextAt < 0)
    return between.some((item) => item.kind === 'booking')
      ? 'submit and book a time'
      : 'submit';
  const next = later[nextAt];
  return next.showWhen
    ? 'skip ahead'
    : `skip to section ${sectionPosition(layout, next.id)}`;
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
      { kind: 'condition-before-question' },
      ({ sectionId, columnId }) =>
        `“${names.section(sectionId)}” is shown depending on “${names.column(columnId)}”, so that question has to come before it.`
    )
    .with(
      { kind: 'gate-section' },
      () => 'A gate holds rules, not questions. Drop it in a section.'
    )
    .with(
      { kind: 'booking-section' },
      () =>
        'The booking step shows a calendar, not questions. Drop it in a section.'
    )
    .with(
      { kind: 'booking-must-be-last' },
      ({ sectionId }) =>
        `The booking step comes last, after every question and gate. Move “${names.section(sectionId)}” to the end.`
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
