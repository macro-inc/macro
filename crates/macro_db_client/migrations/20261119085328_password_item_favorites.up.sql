SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
CREATE TABLE password_item_favorites (
    team_id UUID NOT NULL,
    item_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, item_id, user_id),
    FOREIGN KEY (team_id, item_id) REFERENCES password_item_entities(team_id, id) ON DELETE CASCADE,
    FOREIGN KEY (user_id, team_id) REFERENCES team_user(user_id, team_id) ON DELETE CASCADE
);
CREATE INDEX password_item_favorites_user_idx ON password_item_favorites(team_id, user_id, item_id);

-- Seed only on creation; retries and credential edits cannot restore a removed star.
CREATE FUNCTION password_item_seed_favorite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO password_item_favorites(team_id, item_id, user_id)
    SELECT NEW.team_id, NEW.id, membership.user_id FROM team_user membership
    WHERE membership.team_id=NEW.team_id AND membership.user_id=NEW.user_id
    FOR KEY SHARE OF membership
    ON CONFLICT DO NOTHING;
    RETURN NEW;
END $$;
CREATE TRIGGER password_item_seed_favorite AFTER INSERT ON password_item_entities
    FOR EACH ROW WHEN (NOT NEW.deleting AND NEW.deleted_at IS NULL AND NEW.metadata->>'favorite'='true')
    EXECUTE FUNCTION password_item_seed_favorite();

-- Soft deletion must erase preferences too; physical deletion uses the FK.
CREATE FUNCTION password_item_clear_favorites() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM password_item_favorites WHERE team_id=NEW.team_id AND item_id=NEW.id;
    RETURN NEW;
END $$;
CREATE TRIGGER password_item_clear_favorites AFTER UPDATE OF deleting, deleted_at ON password_item_entities
    FOR EACH ROW WHEN ((NEW.deleting OR NEW.deleted_at IS NOT NULL) AND NOT OLD.deleting AND OLD.deleted_at IS NULL)
    EXECUTE FUNCTION password_item_clear_favorites();
