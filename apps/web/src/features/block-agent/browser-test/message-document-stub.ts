/** Stand-in so the transcript fixture does not load document storage. */
export async function createDocumentFromReply(): Promise<string | undefined> {
  return 'fixture-document';
}
