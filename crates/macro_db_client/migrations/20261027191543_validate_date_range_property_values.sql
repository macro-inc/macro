SET LOCAL lock_timeout = '5s';

ALTER TABLE entity_properties
    VALIDATE CONSTRAINT check_values_structure;
