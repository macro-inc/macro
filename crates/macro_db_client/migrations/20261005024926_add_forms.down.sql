-- Destroys every form, its layout and its response ledger. It unwinds an
-- unshipped schema; it is not a production rollback. The response rows stay
-- in their databases.

DROP TRIGGER IF EXISTS form_entity_access_cleanup ON forms;
DROP FUNCTION IF EXISTS delete_form_entity_access();

-- Every grant on a form, which no foreign key ties to `forms`.
DELETE FROM entity_access WHERE entity_type = 'form';

DROP TABLE form_responses;
DROP TABLE form_questions;
DROP TABLE form_sections;
DROP TABLE forms;
