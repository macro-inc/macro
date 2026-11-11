-- An suggestion is its base row plus exactly one row of its kind. Whatever deletes
-- the kind's row (a deleted routine suggestion cascading into suggestion_routine, a
-- cleanup, a deleted user) deletes the suggestion with it, so no base row is left
-- without its kind.
CREATE FUNCTION delete_suggestion_of_kind_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM suggestion WHERE id = OLD.suggestion_id;
    RETURN OLD;
END;
$$;

CREATE TRIGGER suggestion_prompt_deletes_suggestion
AFTER DELETE ON suggestion_prompt
FOR EACH ROW EXECUTE FUNCTION delete_suggestion_of_kind_row();

CREATE TRIGGER suggestion_entity_deletes_suggestion
AFTER DELETE ON suggestion_entity
FOR EACH ROW EXECUTE FUNCTION delete_suggestion_of_kind_row();

CREATE TRIGGER suggestion_routine_deletes_suggestion
AFTER DELETE ON suggestion_routine
FOR EACH ROW EXECUTE FUNCTION delete_suggestion_of_kind_row();

-- Suggestions already left without their kind's row.
DELETE FROM suggestion i
WHERE NOT EXISTS (SELECT 1 FROM suggestion_prompt WHERE suggestion_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM suggestion_entity WHERE suggestion_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM suggestion_routine WHERE suggestion_id = i.id);
