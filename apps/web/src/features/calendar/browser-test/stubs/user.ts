const NAMES: Record<string, string> = {
  'macro|viewer@example.com': 'Vera Viewer',
  'macro|busy@example.com': 'Blake Busy',
  'macro|open@example.com': 'Olive Open',
};

export function tryMacroId(id: string) {
  return id;
}
export function idToEmail(id: string) {
  return id.replace(/^macro\|/, '');
}
export function emailToMacroId(email: string) {
  return `macro|${email}`;
}
export function getDisplayName(id?: string) {
  return NAMES[id ?? ''] ?? idToEmail(id ?? '');
}
export function getDisplayNameParts(id?: string) {
  const fullName = getDisplayName(id);
  return { firstName: fullName.split(' ')[0] ?? '', lastName: '', fullName };
}
export function getInitials(id?: string) {
  return getDisplayName(id).slice(0, 1);
}
export function isAgentAccount() {
  return false;
}
