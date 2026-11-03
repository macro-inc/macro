-- An anonymous form keeps who voted apart from what they answered:
-- `form_submission_receipts` says who has responded, with no response, row
-- or time, and its key keeps them to one response. The form's ledger
-- entries name nobody.
ALTER TABLE forms RENAME COLUMN respondent_hidden TO anonymous;

CREATE TABLE form_submission_receipts (
    form_id UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY (form_id, user_id)
);

CREATE INDEX idx_form_submission_receipts_user ON form_submission_receipts(user_id);

-- Forms already hiding respondents move them off their ledger entries.
INSERT INTO form_submission_receipts (form_id, user_id)
SELECT r.form_id, r.respondent_id
FROM form_responses r JOIN forms f ON f.id = r.form_id
WHERE f.anonymous AND r.respondent_id IS NOT NULL AND r.status = 'submitted';

DELETE FROM form_responses r USING forms f
WHERE f.id = r.form_id AND f.anonymous AND r.status = 'stopped';

UPDATE form_responses r SET respondent_id = NULL,
    submitted_at = date_trunc('day', r.submitted_at, 'UTC'),
    updated_at = date_trunc('day', r.submitted_at, 'UTC')
FROM forms f
WHERE f.id = r.form_id AND f.anonymous;
