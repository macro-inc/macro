import { match } from 'ts-pattern';

export type SignatureRowAction = 'edit' | 'done' | 'save';

export function signatureRowAction(
  expanded: boolean,
  dirty: boolean
): SignatureRowAction {
  if (!expanded) return 'edit';
  return dirty ? 'save' : 'done';
}

export function signatureRowLabel(action: SignatureRowAction): string {
  return match(action)
    .with('edit', () => 'Edit')
    .with('done', () => 'Done')
    .with('save', () => 'Save')
    .exhaustive();
}

export function finishSignatureRow(input: {
  action: SignatureRowAction;
  save: () => void;
  toggle: () => void;
}): void {
  if (input.action === 'save') {
    input.save();
    return;
  }
  input.toggle();
}
