-- Macro Forms: questionnaires whose answers land as rows of a database table.
--
-- * A form is a view of one table. Every question is a column of that table;
--   the form stores presentation only (sections, order, help text, required,
--   widget, gate rules). Titles, types and options are the column's.
-- * Positions are fractional keys minted by `models_databases::position`, so
--   every position column is `COLLATE "C"`.
-- * `form_responses` is the submission ledger: who answered, when, and
--   whether a gate stopped them. The answers are the row.
-- * A form's grants are `entity_access` rows (`entity_type = 'form'`), which
--   have no foreign key; a trigger removes them with the form, including when
--   the form goes with its database or table.

CREATE TABLE forms (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    -- The table whose rows are the responses. Purging either removes the form.
    database_id UUID NOT NULL REFERENCES databases(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES database_tables(id) ON DELETE CASCADE,
    -- Columns the form writes itself. Deleting one in the grid just stops that write.
    submitted_column_id UUID REFERENCES database_columns(id) ON DELETE SET NULL,
    respondent_column_id UUID REFERENCES database_columns(id) ON DELETE SET NULL,
    -- 'members': signed-in Macro users, one response each.
    -- 'public': anyone with the link, anonymous, no uniqueness.
    audience TEXT NOT NULL DEFAULT 'members' CHECK (audience IN ('members', 'public')),
    -- Whether respondents may see option tallies (polls).
    tally_visible BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closes_at TIMESTAMPTZ,
    confirmation_message TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trashed_at TIMESTAMPTZ
);

CREATE INDEX idx_forms_owner ON forms(owner_id);
-- Forms over a database: derived database access and the databases cascade.
CREATE INDEX idx_forms_database ON forms(database_id);
-- Forms over a table: the grid's chip and the database_tables cascade.
CREATE INDEX idx_forms_table ON forms(table_id);

CREATE TABLE form_sections (
    id UUID PRIMARY KEY,
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    position TEXT COLLATE "C" NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('questions', 'gate')),
    -- A gate's rules: models_databases::views::FilterGroup as JSON. Columns it
    -- names must be questions of earlier sections.
    gate_rules JSONB CHECK (gate_rules IS NULL OR jsonb_typeof(gate_rules) = 'object'),
    gate_message TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_form_sections_form ON form_sections(form_id, position);

CREATE TABLE form_questions (
    id UUID PRIMARY KEY,
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    section_id UUID NOT NULL REFERENCES form_sections(id) ON DELETE CASCADE,
    -- The column this question writes. Deleting the column deletes the question.
    column_id UUID NOT NULL REFERENCES database_columns(id) ON DELETE CASCADE,
    position TEXT COLLATE "C" NOT NULL,
    help_text TEXT NOT NULL DEFAULT '',
    required BOOLEAN NOT NULL DEFAULT FALSE,
    -- Presentation only: how the column's type is asked.
    widget TEXT,
    -- Leads with form_id, so it is also the "questions of a form" index.
    UNIQUE (form_id, column_id)
);

CREATE INDEX idx_form_questions_section ON form_questions(section_id, position);
-- Column deletes find their questions.
CREATE INDEX idx_form_questions_column ON form_questions(column_id);

-- The submission ledger. Answers live in the table; this is who answered,
-- when, and whether a gate stopped them.
CREATE TABLE form_responses (
    id UUID PRIMARY KEY,
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    respondent_id TEXT REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE,
    -- The row the answers were written to. A row deleted in the grid leaves
    -- the ledger entry, with no row.
    row_id UUID REFERENCES database_rows(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('submitted', 'stopped')),
    -- No foreign key: a layout put replaces sections, and history must not
    -- lose which gate stopped a response.
    stopped_at_section UUID,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One response per signed-in person. Anonymous responses are unbounded.
CREATE UNIQUE INDEX form_responses_one_per_person
    ON form_responses (form_id, respondent_id) WHERE respondent_id IS NOT NULL;
CREATE INDEX idx_form_responses_form ON form_responses(form_id, status);
-- Row deletes null their ledger entries.
CREATE INDEX idx_form_responses_row ON form_responses(row_id) WHERE row_id IS NOT NULL;

CREATE FUNCTION delete_form_entity_access()
    RETURNS TRIGGER
    LANGUAGE PLPGSQL
    AS
$$
    BEGIN
        DELETE FROM entity_access WHERE entity_type = 'form' AND entity_id = OLD.id;
        RETURN NULL;
    END;
$$;

CREATE TRIGGER form_entity_access_cleanup
    AFTER DELETE ON forms
    FOR EACH ROW EXECUTE FUNCTION delete_form_entity_access();
