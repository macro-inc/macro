-- A questions section may be shown only when earlier answers pass rules:
-- models_databases::views::FilterGroup as JSON, naming only columns asked in
-- earlier sections. NULL means the section is always shown.
ALTER TABLE form_sections ADD COLUMN show_when JSONB;
ALTER TABLE form_sections ADD CONSTRAINT form_sections_show_when_check CHECK (
    show_when IS NULL
    OR (kind = 'questions' AND jsonb_typeof(show_when) = 'object')
) NOT VALID;
ALTER TABLE form_sections VALIDATE CONSTRAINT form_sections_show_when_check;
