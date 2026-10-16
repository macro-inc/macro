import type { FormSectionDetail } from '../../../generated/storage/types.gen';
import { MacroNotFoundError } from '../../utils';
import type { Form } from './form';
import { FormQuestion } from './question';

/** An ordered group of questions, or a gate between groups. */
export class FormSection {
  private constructor(
    /** The owning form. */
    readonly form: Form,
    /** The section's stable identifier. */
    readonly id: string,
  ) {}

  /** A section handle within a form. */
  static byId(form: Form, id: string): FormSection {
    return new FormSection(form, id);
  }

  /** The section's current presentation. */
  async detail(): Promise<FormSectionDetail> {
    const section = (await this.form.schema()).sections.find(
      (candidate) => candidate.id === this.id,
    );
    if (!section)
      throw new MacroNotFoundError(
        `section ${this.id} is not on form ${this.form.id}`,
      );
    return section;
  }

  /** The section heading. */
  async title(): Promise<string> {
    return (await this.detail()).title;
  }

  /** Questions in display order; gates contain no questions. */
  async questions(): Promise<FormQuestion[]> {
    const section = await this.detail();
    return section.kind === 'questions'
      ? section.questions.map((question) =>
          FormQuestion.byId(this.form, question.id),
        )
      : [];
  }
}
