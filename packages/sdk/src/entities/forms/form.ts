import { match, P } from 'ts-pattern';
import { v7 as uuidv7 } from 'uuid';
import type {
  BookingTarget,
  UnlockedBooking,
  CellValue,
  EntityKind,
  FilterGroup,
  FilterNode,
  FilterTest,
  FormDetail,
  FormLayout,
  ResponseStatus,
  SharePermissionV2,
  SubmissionOutcome,
  UpdateForm,
  UpdateSharePermissionRequestV2,
  Widget,
  FormSection as WireFormSection,
} from '../../../generated/storage/types.gen';
import { MacroError, unwrap } from '../../utils';
import type { MacroClient } from '../../utils/client';
import type { DatabaseColumn } from '../databases/column';
import { Database } from '../databases/database';
import { DatabaseRow } from '../databases/row';
import { DatabaseTable } from '../databases/table';
import { MacroEntity } from '../entity';
import { User } from '../users/user';
import { FormOption, FormQuestion } from './question';
import { FormResponse } from './response';
import { FormSection } from './section';

/** An entity handle used in a reference answer or rule. */
export interface FormEntityHandle {
  /** The entity's identifier. */
  readonly id: string;
}

/** A typed reference read from a form answer, without fetching the referenced entity. */
export class FormReference implements FormEntityHandle {
  private constructor(
    /** The referenced entity's kind. */
    readonly entityType: EntityKind,
    /** The referenced entity's identifier. */
    readonly id: string,
  ) {}

  /** Construct a reference when its kind and identifier are known. */
  static byId(entityType: EntityKind, id: string): FormReference {
    return new FormReference(entityType, id);
  }
}

/** An answer value; references use handles, and scalar values keep their cell representation. */
export type FormAnswerValue =
  | Exclude<CellValue, { type: 'rows' | 'options' | 'entities' }>
  | { type: 'rows'; value: DatabaseRow[] }
  | { type: 'options'; value: FormOption[] }
  | {
      type: 'entities';
      value: { entityType: EntityKind; entity: FormEntityHandle }[];
    };

/** One question and its answer. */
export type FormAnswer = { question: FormQuestion; value: FormAnswerValue };

/** A form rule, with option and entity references represented by handles. */
export type FormRuleTest =
  | Exclude<FilterTest, { kind: 'options' | 'entities' }>
  | {
      kind: 'options';
      operator: Extract<FilterTest, { kind: 'options' }>['operator'];
      options: FormOption[];
    }
  | {
      kind: 'entities';
      operator: Extract<FilterTest, { kind: 'entities' }>['operator'];
      entities: FormEntityHandle[];
    };

/** Conditions over columns asked in earlier sections. */
export type FormRules = {
  conjunction: FilterGroup['conjunction'];
  conditions: (
    | { kind: 'condition'; column: DatabaseColumn; test: FormRuleTest }
    | ({ kind: 'group' } & FormRules)
  )[];
};

/** A question placement in a layout replacement. Omit question to mint a new stable question. */
export type FormQuestionPlacement = {
  question?: FormQuestion;
  column: DatabaseColumn;
  helpText?: string;
  required?: boolean;
  widget?: Widget;
};

/** A section in a layout replacement. Omit section to mint a new stable section. */
export type FormSectionPlacement = {
  section?: FormSection;
  title: string;
  description?: string;
} & (
  | { kind: 'questions'; questions: FormQuestionPlacement[] }
  | { kind: 'gate'; rules: FormRules; message: string }
  | { kind: 'booking'; target: BookingTarget }
);

/** The public Macro booking destination selected by a form editor. */
export type FormBookingTarget = BookingTarget;

/** A booking step released after the form accepts the caller's answers. */
export type FormBookingStep = Omit<UnlockedBooking, 'section'> & { section: FormSection };

/** The result of submitting or editing a response. A stopped submission has no row. */
export type FormSubmissionOutcome =
  | { outcome: 'submitted'; response: FormResponse; row: DatabaseRow; booking?: FormBookingStep }
  | { outcome: 'stopped'; section: FormSection; message: string };

/** The caller's receipt and current answers, read without access to other responses. */
export type MyFormResponse = {
  booking?: FormBookingStep;
  response: FormResponse;
  status: ResponseStatus;
  stoppedAtSection?: FormSection;
  row?: DatabaseRow;
  submittedAt: string;
  updatedAt: string;
  answers: FormAnswer[];
};

/** Counts from the response ledger and its linked table. */
export type FormResponseSummary = {
  submitted: number;
  stopped: number;
  stoppedBySection: { section: FormSection; count: number }[];
  rows: number;
};

/** A question's public tally. Options with no votes are retained. */
export type FormQuestionTally = {
  question: FormQuestion;
  responses: number;
  buckets: {
    value:
      | { kind: 'option'; option: FormOption }
      | { kind: 'checkbox'; checked: boolean };
    count: number;
  }[];
};

/**
 * A form over a database table. Viewers can read its questions and submit;
 * editors can build it and read responses; owners control its audience.
 */
export class Form extends MacroEntity<FormDetail> {
  protected async fetch(): Promise<FormDetail> {
    return unwrap(await this.client.storage.getForm({ path: { id: this.id } }));
  }

  /** A form handle with details loaded on demand. */
  static byId(client: MacroClient, id: string): Form {
    return new Form(client, id);
  }

  /** Create a form, optionally over a table of a database the caller owns. */
  static async create(
    client: MacroClient,
    options: { name: string; table?: DatabaseTable },
  ): Promise<Form> {
    const detail = unwrap(
      await client.storage.createForm({
        body: {
          name: options.name,
          source: options.table
            ? {
                kind: 'table',
                databaseId: options.table.database.id,
                tableId: options.table.id,
              }
            : { kind: 'new' },
        },
      }),
    );
    return new Form(client, detail.form.id, detail);
  }

  /** Forms shared with the caller, or live forms over a specified database. */
  static async list(client: MacroClient, database?: Database): Promise<Form[]> {
    if (!database) {
      const listed = unwrap(await client.storage.listAccessibleForms());
      return listed.map(({ form }) => new Form(client, form.id));
    }
    const forms = unwrap(
      await client.storage.listForms({ query: { databaseId: database.id } }),
    );
    return forms.map((form) => new Form(client, form.id));
  }

  /** The form's presentation and column facts; this never contains response rows. */
  schema(): Promise<FormDetail> {
    return this.detail.get();
  }

  /** The form's display name. */
  readonly name = this.mappedField('form', (form) => form.name);
  /** Introductory text shown to respondents. */
  readonly description = this.mappedField('form', (form) => form.description);
  /** The owning user. */
  readonly owner = this.mappedField('form', (form) =>
    User.byId(this.client, form.ownerId),
  );
  /** The response database. Reading its contents requires separate access. */
  readonly database = this.mappedField('form', (form) =>
    Database.byId(this.client, form.databaseId),
  );
  /** The linked table, without fetching its contents. */
  readonly table = this.mappedField('form', (form) =>
    DatabaseTable.byId(
      Database.byId(this.client, form.databaseId),
      form.tableId,
    ),
  );
  /** Who may respond. */
  readonly audience = this.mappedField('form', (form) => form.audience);
  /** Whether submissions are currently enabled. A closing time can also close the form. */
  readonly status = this.mappedField('form', (form) => form.status);
  /** Scheduled closing time, when set. */
  readonly closesAt = this.mappedField(
    'form',
    (form) => form.closesAt ?? undefined,
  );
  /** The caller's access level. */
  readonly access = this.field('access');

  /** Sections in display order. */
  async sections(): Promise<FormSection[]> {
    return (await this.detail.get()).sections.map((section) =>
      FormSection.byId(this, section.id),
    );
  }

  /** All questions in display order, skipping gates. */
  async questions(): Promise<FormQuestion[]> {
    return (await this.detail.get()).sections.flatMap((section) =>
      section.kind === 'questions'
        ? section.questions.map((question) =>
            FormQuestion.byId(this, question.id),
          )
        : [],
    );
  }

  /** Update presentation or owner-controlled settings; null explicitly clears the closing time. */
  async update(updates: UpdateForm): Promise<this> {
    await this.mutate((client) =>
      client.storage.updateForm({ path: { id: this.id }, body: updates }),
    );
    return this;
  }

  private assertOwns(part: { form: Form }): void {
    if (part.form.id !== this.id)
      throw new MacroError(
        `question or section does not belong to form ${this.id}`,
      );
  }

  /**
   * Replace presentation atomically. Existing handles retain identity; omitted handles
   * mint sections or questions. Column facts are changed through the database API.
   */
  async replaceLayout(sections: FormSectionPlacement[]): Promise<this> {
    const table = await this.table();
    const ownColumn = (column: DatabaseColumn): string => {
      if (
        column.table.id !== table.id ||
        column.table.database.id !== table.database.id
      ) {
        throw new MacroError(
          `column does not belong to form ${this.id}'s table`,
        );
      }
      return column.id;
    };
    const rules = (group: FormRules): FilterGroup => ({
      conjunction: group.conjunction,
      conditions: group.conditions.map(
        (node): FilterNode =>
          match(node)
            .with({ kind: 'group' }, (nested) => ({
              kind: 'group' as const,
              ...rules(nested),
            }))
            .with({ kind: 'condition' }, (condition) => ({
              kind: 'condition' as const,
              column: ownColumn(condition.column),
              test: match(condition.test)
                .with({ kind: 'options' }, (test) => ({
                  ...test,
                  options: test.options.map((option) => option.id),
                }))
                .with({ kind: 'entities' }, (test) => ({
                  ...test,
                  entities: test.entities.map((entity) => entity.id),
                }))
                .with(
                  {
                    kind: P.union(
                      'presence',
                      'text',
                      'number',
                      'date',
                      'checkbox',
                    ),
                  },
                  (test) => test,
                )
                .exhaustive(),
            }))
            .exhaustive(),
      ),
    });
    const body: FormLayout = {
      sections: sections.map((section): WireFormSection => {
        if (section.section) this.assertOwns(section.section);
        const common = {
          id: section.section?.id ?? uuidv7(),
          title: section.title,
          description: section.description ?? '',
        };
        return match(section)
          .with({ kind: 'booking' }, (booking) => ({
            ...common,
            kind: 'booking' as const,
            target: booking.target,
          }))
          .with({ kind: 'gate' }, (gate) => ({
            ...common,
            kind: 'gate' as const,
            rules: rules(gate.rules),
            message: gate.message,
          }))
          .with({ kind: 'questions' }, (group) => ({
            ...common,
            kind: 'questions' as const,
            questions: group.questions.map((question) => {
              if (question.question) this.assertOwns(question.question);
              return {
                id: question.question?.id ?? uuidv7(),
                column: ownColumn(question.column),
                helpText: question.helpText ?? '',
                required: question.required ?? false,
                widget: question.widget ?? null,
              };
            }),
          }))
          .exhaustive();
      }),
    };
    await this.mutate((client) =>
      client.storage.putFormLayout({ path: { id: this.id }, body }),
    );
    return this;
  }

  private wireAnswers(
    answers: FormAnswer[],
  ): { question: string; value: CellValue }[] {
    return answers.map(({ question, value }) => {
      this.assertOwns(question);
      const cell: CellValue = match(value)
        .with({ type: 'rows' }, (answer) => ({
          type: 'rows' as const,
          value: answer.value.map((row) => row.id),
        }))
        .with({ type: 'options' }, (answer) => ({
          type: 'options' as const,
          value: answer.value.map((option) => {
            if (
              option.question.id !== question.id ||
              option.question.form.id !== this.id
            ) {
              throw new MacroError(
                'option does not belong to the answered question',
              );
            }
            return { id: option.id };
          }),
        }))
        .with({ type: 'entities' }, (answer) => ({
          type: 'entities' as const,
          value: answer.value.map(({ entityType, entity }) => ({
            entityType,
            entityId: entity.id,
          })),
        }))
        .with(
          {
            type: P.union('text', 'number', 'boolean', 'date', 'link', 'clear'),
          },
          (answer) => answer,
        )
        .exhaustive();
      return { question: question.id, value: cell };
    });
  }

  private unlockedBooking(booking: UnlockedBooking | undefined): FormBookingStep | undefined {
    return booking ? { ...booking, section: FormSection.byId(this, booking.section) } : undefined;
  }

  private async outcome(
    result: SubmissionOutcome,
    answers: FormAnswer[],
  ): Promise<FormSubmissionOutcome> {
    return match(result)
      .with({ outcome: 'stopped' }, (stopped) => ({
        ...stopped,
        section: FormSection.byId(this, stopped.section),
      }))
      .with({ outcome: 'submitted' }, async (submitted) => {
        const row = DatabaseRow.byId(await this.table(), submitted.row);
        const booking = this.unlockedBooking(submitted.booking);
        return {
          outcome: 'submitted' as const,
          response: FormResponse.byId(this, submitted.response, {
            status: 'submitted',
            row,
            answers,
            booking,
          }),
          row,
          ...(booking ? { booking } : {}),
        };
      })
      .exhaustive();
  }

  /** Submit answers. Signed-in respondents get at most one response; use editResponse afterwards. */
  async submit(answers: FormAnswer[]): Promise<FormSubmissionOutcome> {
    const body = { answers: this.wireAnswers(answers) };
    return this.outcome(
      unwrap(
        await this.client.storage.submitFormResponse({
          path: { id: this.id },
          body,
        }),
      ),
      answers,
    );
  }

  /** Replace the caller's answers while the form is open; gates are evaluated again. */
  async editResponse(answers: FormAnswer[]): Promise<FormSubmissionOutcome> {
    const body = { answers: this.wireAnswers(answers) };
    return this.outcome(
      unwrap(
        await this.client.storage.editMyFormResponse({
          path: { id: this.id },
          body,
        }),
      ),
      answers,
    );
  }

  /** Read the caller's receipt and answers without reading anyone else's responses. */
  async myResponse(): Promise<MyFormResponse> {
    const mine = unwrap(
      await this.client.storage.getMyFormResponse({ path: { id: this.id } }),
    );
    const table = await this.table();
    const answers = await Promise.all(
      mine.answers.map(async (answer): Promise<FormAnswer> => {
        const question = FormQuestion.byId(this, answer.question);
        const value = await match(answer.value)
          .with({ type: 'options' }, (cell) => ({
            type: 'options' as const,
            value: cell.value.map((option) => {
              if (!('id' in option))
                throw new MacroError(
                  'stored form answers must reference options by id',
                );
              return FormOption.byId(question, option.id);
            }),
          }))
          .with({ type: 'entities' }, (cell) => ({
            type: 'entities' as const,
            value: cell.value.map((entity) => ({
              entityType: entity.entityType,
              entity: FormReference.byId(entity.entityType, entity.entityId),
            })),
          }))
          .with({ type: 'rows' }, async (cell) => {
            const detail = await question.detail();
            if (detail.kind.type !== 'relation')
              throw new MacroError('row answer requires a relation question');
            const related = DatabaseTable.byId(
              Database.byId(this.client, detail.kind.database),
              detail.kind.table,
            );
            return {
              type: 'rows' as const,
              value: cell.value.map((row) => DatabaseRow.byId(related, row)),
            };
          })
          .with(
            {
              type: P.union(
                'text',
                'number',
                'boolean',
                'date',
                'link',
                'clear',
              ),
            },
            (cell) => cell,
          )
          .exhaustive();
        return { question, value };
      }),
    );
    const row = mine.response.row
      ? DatabaseRow.byId(table, mine.response.row)
      : undefined;
    const booking = this.unlockedBooking(mine.booking);
    return {
      ...(booking ? { booking } : {}),
      response: FormResponse.byId(this, mine.response.id, {
        status: mine.response.status,
        row,
        answers,
        booking,
      }),
      status: mine.response.status,
      stoppedAtSection: mine.response.stoppedAtSection
        ? FormSection.byId(this, mine.response.stoppedAtSection)
        : undefined,
      row,
      submittedAt: mine.response.submittedAt,
      updatedAt: mine.response.updatedAt,
      answers,
    };
  }

  /** Ledger counts and total table rows; requires edit access. */
  async responseSummary(): Promise<FormResponseSummary> {
    const summary = unwrap(
      await this.client.storage.getFormResponseSummary({
        path: { id: this.id },
      }),
    );
    return {
      ...summary,
      stoppedBySection: summary.stoppedBySection.map((count) => ({
        section: FormSection.byId(this, count.section),
        count: count.count,
      })),
    };
  }

  /** Choice and checkbox counts, available to viewers when tally visibility is enabled. */
  async tally(): Promise<FormQuestionTally[]> {
    const tally = unwrap(
      await this.client.storage.getFormTally({ path: { id: this.id } }),
    );
    return tally.questions.map((entry) => {
      const question = FormQuestion.byId(this, entry.question);
      return {
        question,
        responses: entry.responses,
        buckets: entry.buckets.map((bucket) => ({
          count: bucket.count,
          value: match(bucket.value)
            .with({ kind: 'option' }, (value) => ({
              kind: 'option' as const,
              option: FormOption.byId(question, value.option),
            }))
            .with({ kind: 'checkbox' }, (value) => value)
            .exhaustive(),
        })),
      };
    });
  }

  /** Read the form's sharing grants. Requires ownership. */
  async sharePermissions(): Promise<SharePermissionV2> {
    return unwrap(
      await this.client.storage.getFormPermissions({ path: { id: this.id } }),
    );
  }

  /** Update grants. Public responding is controlled by audience, not link sharing. */
  updateSharePermissions(
    request: UpdateSharePermissionRequestV2,
  ): Promise<SharePermissionV2> {
    return this.mutate((client) =>
      client.storage.updateFormPermissions({
        path: { id: this.id },
        body: request,
      }),
    );
  }

  /** Open the form's builder in Macro. */
  webUrl(): string {
    return `${this.client.webAppUrl}/app/form/${this.id}`;
  }

  /** The respondent page, which public forms also expose without signing in. */
  respondUrl(): string {
    return `${this.client.webAppUrl}/app/form/${this.id}/respond`;
  }
}
