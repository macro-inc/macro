export type CodexLoginDisplay = {
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
  status: 'pending' | 'connected' | 'expired' | 'failed';
};
export type CodexConnectionDisplay = {
  connected: boolean;
  email?: string | null;
  accountId?: string | null;
  environmentId?: string | null;
};
