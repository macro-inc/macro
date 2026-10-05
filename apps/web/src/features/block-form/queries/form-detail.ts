/** The forms service's wire shapes, projected into the feature's vocabulary and back. */

import type { Form } from '@service-storage/generated/schemas/form';
import type { FormDetail as WireFormDetail } from '@service-storage/generated/schemas/formDetail';
import type { FormLayout as WireFormLayout } from '@service-storage/generated/schemas/formLayout';
import type { FormSectionDetail } from '@service-storage/generated/schemas/formSectionDetail';
import { match } from 'ts-pattern';
import type {
  FormColumn,
  FormDetail,
  FormLayout,
  FormMetadata,
  FormSection,
  GateRules,
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
      questions: [],
    }))
    .exhaustive();
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

/** The document `PUT /forms/{id}/layout` takes. */
export function toLayoutDocument(layout: FormLayout): WireFormLayout {
  return {
    sections: layout.sections.map((section) =>
      section.kind === 'gate'
        ? {
            kind: 'gate',
            id: section.id,
            title: section.title,
            description: section.description,
            rules: gateRulesOf(section),
            message: section.gateMessage,
          }
        : {
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
          }
    ),
  };
}
