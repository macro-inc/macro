/**
 * Raised by `DocumentEditor` when the AI references a node id that doesn't exist
 * or violates a sanity check, and by `Doc` when an edit fails to resolve at apply
 * time. The tool catches it and reports the message straight back to the model.
 */
export class EditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditError';
  }
}
