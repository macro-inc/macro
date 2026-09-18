/** Mirrors workspace_privacy::domain::PrivacyStatus. */
export type WorkspacePrivacyStatus = {
  team_id: string | null;
  hipaa_enabled: boolean;
  hipaa_ready: boolean;
  paid: boolean;
  is_admin: boolean;
  revision: number;
};
