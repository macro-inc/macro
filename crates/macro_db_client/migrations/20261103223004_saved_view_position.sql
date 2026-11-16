-- Each viewer's own sidebar order for the saved views they can see, including
-- teammates' shared views. Positions are not part of a definition's revision.
SET LOCAL lock_timeout = '2s';
CREATE TABLE saved_view_position (
    user_id text NOT NULL REFERENCES "User" (id) ON DELETE CASCADE ON UPDATE CASCADE,
    saved_view_id uuid NOT NULL REFERENCES saved_view (id) ON DELETE CASCADE,
    position integer NOT NULL CHECK (position >= 0),
    PRIMARY KEY (user_id, saved_view_id)
);
CREATE INDEX saved_view_position_view_idx ON saved_view_position (saved_view_id);
