type SessionStatus =
  | 'unavailable'
  | 'signed-out'
  | 'team-unresolved'
  | 'rejected'
  | 'signed-in';

export type SessionResult = { status: SessionStatus };

async function localStatus(
  suffix = '',
  options?: RequestInit
): Promise<SessionStatus | 'code-sent'> {
  try {
    const response = await fetch(__BOTS_LOCAL_AUTH__ + suffix, options);
    const body: unknown = await response.json();
    if (body && typeof body === 'object' && 'status' in body) {
      switch (body.status) {
        case 'unavailable':
        case 'signed-out':
        case 'team-unresolved':
        case 'rejected':
        case 'signed-in':
        case 'code-sent':
          return body.status;
      }
    }
  } catch {
    // A stopped or unreachable local server never grants a session.
  }
  return 'unavailable';
}

export const session = {
  async getSession(): Promise<SessionResult> {
    if (!__BOTS_LOCAL_AUTH__) return { status: 'signed-out' };
    const status = await localStatus();
    return { status: status === 'code-sent' ? 'unavailable' : status };
  },
  async begin(): Promise<boolean> {
    if (!__BOTS_LOCAL_AUTH__) return false;
    return (await localStatus('/begin', { method: 'POST' })) === 'code-sent';
  },
  async complete(code: string): Promise<SessionResult> {
    if (!__BOTS_LOCAL_AUTH__) return { status: 'unavailable' };
    const status = await localStatus('/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: code,
    });
    return { status: status === 'code-sent' ? 'unavailable' : status };
  },
};
