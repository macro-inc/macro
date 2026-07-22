-- Replace the existing lookup index with a unique partial index so that a
-- non-null auto-join domain can belong to at most one team.
DROP INDEX team_auto_join_domain_idx;

CREATE UNIQUE INDEX team_auto_join_domain_idx
    ON team (auto_join_domain)
    WHERE auto_join_domain IS NOT NULL;
