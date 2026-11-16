import type { ResponseStatus } from '../../../generated/storage/types.gen';
import { Lazy, MacroNotFoundError } from '../../utils';
import type { DatabaseRow } from '../databases/row';
import type { Form, FormAnswer, FormBookingStep } from './form';

type ResponseSnapshot = {
  status: ResponseStatus;
  booking?: FormBookingStep;
  row?: DatabaseRow;
  answers: FormAnswer[];
};

/** A cached receipt for the caller's response; other respondents' receipts are private. */
export class FormResponse {
  private detail: Lazy<ResponseSnapshot>;

  private constructor(
    /** The form that received this response. */
    readonly form: Form,
    /** The response ledger entry's identifier. */
    readonly id: string,
    snapshot?: ResponseSnapshot,
  ) {
    this.detail = new Lazy(() => this.load(), snapshot);
  }

  private async load(): Promise<ResponseSnapshot> {
    const current = await this.form.myResponse();
    if (current.kind === 'anonymous' || current.response.id !== this.id)
      throw new MacroNotFoundError(
        `response ${this.id} is not your current response`,
      );
    return current;
  }

  /** A response handle, optionally seeded with an already returned receipt. */
  static byId(
    form: Form,
    id: string,
    snapshot?: ResponseSnapshot,
  ): FormResponse {
    return new FormResponse(form, id, snapshot);
  }

  /**
   * Whether this receipt was submitted or stopped by a gate.
   *
   * @readonly
   */
  async status(): Promise<ResponseStatus> {
    return (await this.detail.get()).status;
  }

  /**
   * The receipt's row, if any. Reading that row requires database access.
   *
   * @readonly
   */
  async row(): Promise<DatabaseRow | undefined> {
    return (await this.detail.get()).row;
  }

  /**
   * Answers as submitted or last read. Refresh to include later changes to the row.
   *
   * @readonly
   */
  async answers(): Promise<FormAnswer[]> {
    return (await this.detail.get()).answers;
  }

  /**
   * The booking step unlocked by this saved response, if any.
   *
   * @readonly
   */
  async booking(): Promise<FormBookingStep | undefined> {
    return (await this.detail.get()).booking;
  }

  /**
   * Reload the caller's current receipt; requires a signed-in respondent.
   *
   * @readonly
   */
  async refresh(): Promise<this> {
    const snapshot = await this.load();
    this.detail = new Lazy(() => this.load(), snapshot);
    return this;
  }
}
