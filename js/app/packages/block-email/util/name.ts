export function getFirstName(name: string | null | undefined) {
  if (!name) return '';
  if (name.toLowerCase().startsWith('the ')) return name.replace(/,+$/, '');
  return name.split(' ')[0].replace(/,+$/, '');
}
