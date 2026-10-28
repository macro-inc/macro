-- NULL preserves existing, manually managed labels. Smart memberships are
-- evaluated from current channel attributes; they are never assignment rows.
ALTER TABLE channel_label
    ADD COLUMN name_contains text,
    ADD CONSTRAINT channel_label_name_contains_check CHECK (
        name_contains IS NULL OR
        (char_length(name_contains) BETWEEN 1 AND 200 AND name_contains = btrim(name_contains))
    );
