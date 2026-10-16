import type {
  FormQuestionDetail,
  QuestionOption,
} from '../../../generated/storage/types.gen';
import { MacroNotFoundError } from '../../utils';
import { DatabaseColumn } from '../databases/column';
import type { Form } from './form';

/** One question, backed by a column. Its details never require reading the response table. */
export class FormQuestion {
  private constructor(
    /** The form that asks this question. */
    readonly form: Form,
    /** The question's stable identifier within its form layout. */
    readonly id: string,
  ) {}

  /** A question handle within a form. */
  static byId(form: Form, id: string): FormQuestion {
    return new FormQuestion(form, id);
  }

  /** The question's current presentation and column facts. */
  async detail(): Promise<FormQuestionDetail> {
    const detail = await this.form.schema();
    const question = detail.sections
      .flatMap((section) =>
        section.kind === 'questions' ? section.questions : [],
      )
      .find((candidate) => candidate.id === this.id);
    if (!question)
      throw new MacroNotFoundError(
        `question ${this.id} is not on form ${this.form.id}`,
      );
    return question;
  }

  /** The question's current title (its column's name). */
  async title(): Promise<string> {
    return (await this.detail()).title;
  }

  /** The column behind the question. Reading the column itself needs database access. */
  async column(): Promise<DatabaseColumn> {
    return DatabaseColumn.byId(
      await this.form.table(),
      (await this.detail()).column,
    );
  }

  /** Current choices, in display order. */
  async options(): Promise<FormOption[]> {
    return (await this.detail()).options.map((option) =>
      FormOption.byId(this, option.id),
    );
  }
}

/** A choice of one form question, resolved through that question's current options. */
export class FormOption {
  private constructor(
    /** The question offering this choice. */
    readonly question: FormQuestion,
    /** The backing database option's identifier. */
    readonly id: string,
  ) {}

  /** A handle to a known choice of a question. */
  static byId(question: FormQuestion, id: string): FormOption {
    return new FormOption(question, id);
  }

  /** The choice's label and color. */
  async detail(): Promise<QuestionOption> {
    const option = (await this.question.detail()).options.find(
      (candidate) => candidate.id === this.id,
    );
    if (!option)
      throw new MacroNotFoundError(
        `option ${this.id} is not on question ${this.question.id}`,
      );
    return option;
  }

  /** The choice's label. */
  async label(): Promise<string> {
    return (await this.detail()).label;
  }

  /** The choice's color, when one is set. */
  async color(): Promise<string | undefined> {
    return (await this.detail()).color ?? undefined;
  }
}
