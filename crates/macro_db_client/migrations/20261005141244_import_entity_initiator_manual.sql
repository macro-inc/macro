ALTER TABLE import_entity DROP CONSTRAINT import_entity_initiator_check;
ALTER TABLE import_entity ADD CONSTRAINT import_entity_initiator_check
    CHECK (initiator IN ('onboarding', 'chat', 'archive', 'manual'));
