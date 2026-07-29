-- Teams can opt in to automatic joining: any new user whose email domain
-- matches a team's auto_join_domain is added to that team on signup.
ALTER TABLE team
    ADD COLUMN auto_join_domain TEXT;

-- Partial index: auto_join_domain is looked up alone (by new-user signup
-- auto-join) and is NULL for the vast majority of teams.
CREATE INDEX team_auto_join_domain_idx
    ON team (auto_join_domain)
    WHERE auto_join_domain IS NOT NULL;
