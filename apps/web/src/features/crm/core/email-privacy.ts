export type EmailPrivacy = {
  enabled: boolean;
  mailboxEmail: string | null;
  mailboxLinkId: string | null;
  teamDomains: string[];
  personalDomains: string[];
  canRemoveTeamDomains: boolean;
};

export type EmailBlockScope = 'team' | 'personal';
export type ExcludedThreads = {
  threads: { threadId: string; linkId: string; subject: string | null }[];
  nextCursor: string | null;
};

export type EmailPrivacyChange =
  | { action: 'set_thread_exclusion'; thread_id: string; excluded: boolean }
  | { action: 'set_consent'; enabled: boolean; link_id?: string | null }
  | {
      action: 'add_domain' | 'remove_domain';
      scope: EmailBlockScope;
      domain: string;
    };
