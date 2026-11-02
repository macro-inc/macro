-- A property whose value spans a start and an end date-time.
-- Keep this separate from the value constraint: enum values must be committed before use.
ALTER TYPE property_data_type ADD VALUE IF NOT EXISTS 'DATE_RANGE';
