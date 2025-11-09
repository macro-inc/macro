export function getFirstName(name: string | null | undefined) {
  if (!name) return '';
  return name.split(' ')[0];
}
