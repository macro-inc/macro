-- Pending GitHub App installation requests awaiting org-admin approval.
--
-- When a non-admin requests the sync app install, GitHub's setup callback
-- carries setup_action=request with no installation_id (the installation does
-- not exist until an admin approves). The callback's OAuth code identifies the
-- requesting GitHub user, so the requested Macro source is parked here and the
-- association completes when the installation.created webhook arrives with a
-- matching requester.
--
-- Keyed by requester so a repeat request (e.g. after switching teams) replaces
-- the earlier one: only the requester's latest intent is honored on approval.
CREATE TABLE github_app_installation_request
(
    github_user_id TEXT PRIMARY KEY,                          -- The stable numeric github user id of the requester
    source_id      TEXT                                NOT NULL,
    source_type    github_app_installation_source_type NOT NULL,
    created_at     TIMESTAMPTZ                         NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ                         NOT NULL DEFAULT NOW()
);
