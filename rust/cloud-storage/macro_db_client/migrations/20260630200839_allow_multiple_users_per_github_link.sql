-- Relax GitHub account linking from "one GitHub account per user" to
-- "many Macro users may share one GitHub account". The unique index from
-- migration 20260226142003 encoded the old assumption and blocks a second
-- user from linking a GitHub account already linked by another user.
DROP INDEX IF EXISTS uq_github_links_github_user_id;

-- Keep GitHub-account lookups fast (sync queries by github_user_id) with a
-- non-unique index.
CREATE INDEX idx_github_links_github_user_id
    ON public.github_links (github_user_id);

-- Composite guard: a single user still cannot link the same GitHub account twice.
CREATE UNIQUE INDEX uq_github_links_macro_id_github_user_id
    ON public.github_links (macro_id, github_user_id);
