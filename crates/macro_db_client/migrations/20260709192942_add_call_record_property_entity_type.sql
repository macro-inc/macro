-- Allow entity properties (e.g. tags) to be attached to call records.
ALTER TYPE property_entity_type ADD VALUE IF NOT EXISTS 'CALL_RECORD';
