-- Records which GitHub user installed each GitHub App installation, so an
-- installation can be associated with Macro sources when the installer links
-- their GitHub account after installing the app.
CREATE TABLE github_app_installation_installer
(
    installation_id TEXT PRIMARY KEY, -- The github installation id converted to a string
    github_user_id  TEXT        NOT NULL, -- The stable numeric github user id of the installer
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "github_app_installation_installer_github_user_id_idx"
    ON github_app_installation_installer (github_user_id);

-- Backfill installers for existing user-sourced installations. A user source's
-- source_id is a macro user id that was linked to the installer's github
-- account at install time, so reversing through github_links recovers the
-- installer's github user id. Installations whose user sources resolve to more
-- than one github account are skipped rather than guessed at, as are
-- team-sourced installations (the installing team member is not recoverable).
INSERT INTO github_app_installation_installer (installation_id, github_user_id)
SELECT gai.id, MIN(gl.github_user_id)
FROM github_app_installation gai
         JOIN github_links gl ON gl.macro_id = gai.source_id
WHERE gai.source_type = 'user'::github_app_installation_source_type
GROUP BY gai.id
HAVING COUNT(DISTINCT gl.github_user_id) = 1;
