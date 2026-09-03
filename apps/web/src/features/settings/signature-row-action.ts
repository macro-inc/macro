export type SignatureRowAction = 'edit' | 'done' | 'save';

export function signatureRowAction(
  expanded: boolean,
  dirty: boolean
): SignatureRowAction {
  if (!expanded) return 'edit';
  return dirty ? 'save' : 'done';
}

export function signatureRowLabel(action: SignatureRowAction): string {
  switch (action) {
    case 'edit':
      return 'Edit';
    case 'done':
      return 'Done';
    case 'save':
      return 'Save';
    default: {
      const _never: never = action;
      return _never;
    }
  }
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
