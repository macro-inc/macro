export function getFirstName(name: string | null | undefined) {
  if (!name) return '';
  if (name.toLowerCase().startsWith('the ')) return name.replace(/,+$/, '');

  const trimmed = name.trim();

  // Handle "LastName, FirstName [MiddleInitial]" format (common in Outlook)
  if (trimmed.includes(',')) {
    const [, rest] = trimmed.split(',', 2);
    if (rest) {
      const firstName = rest.trim().split(/\s+/)[0];
      if (firstName) return firstName.replace(/,+$/, '');
    }
  }

  return trimmed.split(' ')[0].replace(/,+$/, '');
}
