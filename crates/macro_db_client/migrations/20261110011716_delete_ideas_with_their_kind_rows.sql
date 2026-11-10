-- An idea is its base row plus exactly one row of its kind. Whatever deletes
-- the kind's row (a deleted routine suggestion cascading into idea_routine, a
-- cleanup, a deleted user) deletes the idea with it, so no base row is left
-- without its kind.
CREATE FUNCTION delete_idea_of_kind_row() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    DELETE FROM idea WHERE id = OLD.idea_id;
    RETURN OLD;
END;
$$;

CREATE TRIGGER idea_prompt_deletes_idea
AFTER DELETE ON idea_prompt
FOR EACH ROW EXECUTE FUNCTION delete_idea_of_kind_row();

CREATE TRIGGER idea_entity_deletes_idea
AFTER DELETE ON idea_entity
FOR EACH ROW EXECUTE FUNCTION delete_idea_of_kind_row();

CREATE TRIGGER idea_routine_deletes_idea
AFTER DELETE ON idea_routine
FOR EACH ROW EXECUTE FUNCTION delete_idea_of_kind_row();

-- Ideas already left without their kind's row.
DELETE FROM idea i
WHERE NOT EXISTS (SELECT 1 FROM idea_prompt WHERE idea_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM idea_entity WHERE idea_id = i.id)
  AND NOT EXISTS (SELECT 1 FROM idea_routine WHERE idea_id = i.id);
