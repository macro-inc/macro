export async function fetchDocToken(
  dssBase: string,
  documentId: string,
  userToken: string
): Promise<string> {
  const resp = await fetch(
    `${dssBase}/documents/permissions_token/${documentId}`,
    { method: 'POST', headers: { Authorization: `Bearer ${userToken}` } }
  );
  if (!resp.ok) {
    throw new Error(`failed to get document permission token: ${resp.status}`);
  }
  const { token } = (await resp.json()) as { token: string };
  return token;
}
