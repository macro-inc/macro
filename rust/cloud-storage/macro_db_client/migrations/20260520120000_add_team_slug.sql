ALTER TABLE team
    ADD COLUMN slug VARCHAR(20) NOT NULL DEFAULT 'MACRO',
    ADD CONSTRAINT team_slug_format_check CHECK (slug ~ '^[A-Z]+(_[A-Z]+)*$');
