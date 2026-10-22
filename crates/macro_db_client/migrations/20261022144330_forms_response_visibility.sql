-- Channel polls can share individual responses with everyone who can vote,
-- and can hide who voted while still recording them so nobody votes twice.
ALTER TABLE forms
    ADD COLUMN responses_visible BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN respondent_hidden BOOLEAN NOT NULL DEFAULT FALSE;
