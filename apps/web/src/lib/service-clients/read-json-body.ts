/**
 * The parsed JSON body of an error response, or null when it is not JSON. An
 * error handler uses it so a failure to parse never replaces the error.
 */
export async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
