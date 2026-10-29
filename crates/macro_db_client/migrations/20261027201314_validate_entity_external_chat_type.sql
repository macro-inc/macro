-- Validate the entity type check the previous migration added NOT VALID, in
-- its own transaction so the scan holds only a SHARE UPDATE EXCLUSIVE lock.
SET LOCAL lock_timeout = '5s';

ALTER TABLE entity VALIDATE CONSTRAINT entity_entity_type_check;
