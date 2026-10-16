/** The forms service's wire shapes, projected into the feature's vocabulary and back. */

import type { Form } from '@service-storage/generated/schemas/form';
import type { FormDetail as WireFormDetail } from '@service-storage/generated/schemas/formDetail';
import type { FormLayout as WireFormLayout } from '@service-storage/generated/schemas/formLayout';
import type { FormSectionDetail } from '@service-storage/generated/schemas/formSectionDetail';
import type { MyResponse as WireMyResponse } from '@service-storage/generated/schemas/myResponse';
import type { SubmissionOutcome } from '@service-storage/generated/schemas/submissionOutcome';
import type { UnlockedBooking as WireUnlockedBooking } from '@service-storage/generated/schemas/unlockedBooking';
import { match } from 'ts-pattern';
import type { MyResponse, SubmitOutcome } from '../context/form-context';
import type {
  FormBookingTarget,
  FormColumn,
  FormDetail,
  FormLayout,
  FormMetadata,
  FormSection,
  GateRules,
  UnlockedBooking,
} from '../core/form-model';

export function toFormMetadata(form: Form): FormMetadata {
  return {
    id: form.id,
    name: form.name,
    description: form.description,
    ownerId: form.ownerId,
    databaseId: form.databaseId,
    tableId: form.tableId,
    audience: form.audience,
    status: form.status,
    closesAt: form.closesAt ?? null,
    tallyVisible: form.tallyVisible,
    confirmationMessage: form.confirmationMessage,
    submittedColumnId: form.submittedColumnId ?? null,
    respondentColumnId: form.respondentColumnId ?? null,
  };
}

function toSection(section: FormSectionDetail): FormSection {
  return match(section)
    .returnType<FormSection>()
    .with({ kind: 'questions' }, (questions) => ({
      id: questions.id,
      title: questions.title,
      description: questions.description,
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      bookingTarget: null,
      questions: questions.questions.map((question) => ({
        id: question.id,
        columnId: question.column,
        helpText: question.helpText,
        required: question.required,
        widget: question.widget ?? null,
      })),
    }))
    .with({ kind: 'gate' }, (gate) => ({
      id: gate.id,
      title: gate.title,
      description: gate.description,
      kind: 'gate',
      gateRules: gate.rules,
      gateMessage: gate.message,
      bookingTarget: null,
      questions: [],
    }))
    .with({ kind: 'booking' }, (booking) => ({
      id: booking.id,
      title: booking.title,
      description: booking.description,
      kind: 'booking',
      gateRules: null,
      gateMessage: '',
      // Editors only: a respondent's detail withholds where it books.
      bookingTarget: booking.target ? toBookingTarget(booking.target) : null,
      questions: [],
    }))
    .exhaustive();
}

function toBookingTarget(target: FormBookingTarget): FormBookingTarget {
  return { profileId: target.profileId, eventTypeId: target.eventTypeId };
}

/** The columns the questions ask, as the detail joins them. */
function questionColumns(detail: WireFormDetail): FormColumn[] {
  return detail.sections.flatMap((section) =>
    section.kind === 'questions'
      ? section.questions.map((question) => ({
          id: question.column,
          name: question.title,
          kind: question.kind,
          options: question.options.map((option) => ({
            id: option.id,
            label: option.label,
            color: option.color ?? null,
          })),
        }))
      : []
  );
}

export function toFormDetail(detail: WireFormDetail): FormDetail {
  return {
    form: toFormMetadata(detail.form),
    layout: { sections: detail.sections.map(toSection) },
    columns: questionColumns(detail),
    access: detail.access,
    tableGone: detail.tableGone,
  };
}

/**
 * A gate's rules, which every gate carries (an empty group passes everyone).
 * One without is a broken editor state, reported rather than papered over.
 */
function gateRulesOf(section: FormSection): GateRules {
  if (!section.gateRules) throw new Error(`Gate “${section.id}” has no rules`);
  return section.gateRules;
}

/**
 * A booking step's target, which every booking step an editor saves carries.
 * One without is a respondent's view of the form, never a layout to save.
 */
function bookingTargetOf(section: FormSection): FormBookingTarget {
  if (!section.bookingTarget)
    throw new Error(`Booking step “${section.id}” has no booking link`);
  return section.bookingTarget;
}

/** The shared layout document, in the builder's vocabulary. */
export function toFormLayout(layout: WireFormLayout): FormLayout {
  return {
    sections: layout.sections.map((section) =>
      match(section)
        .returnType<FormSection>()
        .with({ kind: 'questions' }, (questions) => ({
          id: questions.id,
          title: questions.title,
          description: questions.description,
          kind: 'questions',
          gateRules: null,
          gateMessage: '',
          bookingTarget: null,
          questions: questions.questions.map((question) => ({
            id: question.id,
            columnId: question.column,
            helpText: question.helpText,
            required: question.required,
            widget: question.widget ?? null,
          })),
        }))
        .with({ kind: 'gate' }, (gate) => ({
          id: gate.id,
          title: gate.title,
          description: gate.description,
          kind: 'gate',
          gateRules: gate.rules,
          gateMessage: gate.message,
          bookingTarget: null,
          questions: [],
        }))
        .with({ kind: 'booking' }, (booking) => ({
          id: booking.id,
          title: booking.title,
          description: booking.description,
          kind: 'booking',
          gateRules: null,
          gateMessage: '',
          bookingTarget: toBookingTarget(booking.target),
          questions: [],
        }))
        .exhaustive()
    ),
  };
}

/** The layout document the forms service and the shared document take. */
export function toLayoutDocument(layout: FormLayout): WireFormLayout {
  return {
    sections: layout.sections.map((section) =>
      match(section.kind)
        .returnType<WireFormLayout['sections'][number]>()
        .with('gate', () => ({
          kind: 'gate',
          id: section.id,
          title: section.title,
          description: section.description,
          rules: gateRulesOf(section),
          message: section.gateMessage,
        }))
        .with('booking', () => ({
          kind: 'booking',
          id: section.id,
          title: section.title,
          description: section.description,
          target: bookingTargetOf(section),
        }))
        .with('questions', () => ({
          kind: 'questions',
          id: section.id,
          title: section.title,
          description: section.description,
          questions: section.questions.map((question) => ({
            id: question.id,
            column: question.columnId,
            helpText: question.helpText,
            required: question.required,
            widget: question.widget,
          })),
        }))
        .exhaustive()
    ),
  };
}

function toUnlockedBooking(
  booking: WireUnlockedBooking | undefined
): UnlockedBooking | null {
  if (!booking) return null;
  return {
    sectionId: booking.section,
    title: booking.title,
    description: booking.description,
    target: toBookingTarget(booking.target),
  };
}

export function toSubmitOutcome(outcome: SubmissionOutcome): SubmitOutcome {
  return match(outcome)
    .returnType<SubmitOutcome>()
    .with({ outcome: 'submitted' }, ({ response, booking }) => ({
      kind: 'submitted',
      responseId: response,
      booking: toUnlockedBooking(booking),
    }))
    .with({ outcome: 'stopped' }, ({ section, message }) => ({
      kind: 'stopped',
      sectionId: section,
      message,
    }))
    .exhaustive();
}

export function toMyResponse(mine: WireMyResponse): MyResponse {
  return {
    status: mine.response.status,
    submittedAt: mine.response.submittedAt,
    answers: mine.answers,
    booking: toUnlockedBooking(mine.booking),
  };
}
