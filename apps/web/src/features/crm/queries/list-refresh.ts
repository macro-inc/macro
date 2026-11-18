function excludesCrmRecords(filter: unknown): boolean {
  if (typeof filter !== 'object' || filter === null) return false;
  if ('&' in filter && Array.isArray(filter['&']))
    return filter['&'].some(excludesCrmRecords);
  return (
    'l' in filter &&
    typeof filter.l === 'object' &&
    filter.l !== null &&
    'id' in filter.l &&
    filter.l.id === '00000000-0000-0000-0000-000000000000'
  );
}

export function listCanIncludeCrm(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const excludesCompanies = 'ccf' in body && excludesCrmRecords(body.ccf);
  // Contacts are opt-in, unlike companies in a general Soup list.
  const excludesContacts = !listCanIncludeCrmContacts(body);
  return !(excludesCompanies && excludesContacts);
}

/** Contacts are an explicit Soup target; an absent or excluded target cannot change. */
export function listCanIncludeCrmContacts(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'crmf' in body &&
    body.crmf != null &&
    !excludesCrmRecords(body.crmf)
  );
}
