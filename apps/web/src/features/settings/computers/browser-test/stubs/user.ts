// Everything else the app imports from it is the real module's.
export * from '../../../../../lib/core/user';
export function tryMacroId(id: string) {
  return id;
}

export function getDisplayNameParts() {
  return { firstName: 'Maya', lastName: '', fullName: 'Maya' };
}

export function getDisplayName() {
  return 'Maya';
}

export function getInitials() {
  return 'M';
}

export function isAgentAccount() {
  return false;
}
