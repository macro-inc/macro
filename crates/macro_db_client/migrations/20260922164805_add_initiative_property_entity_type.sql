-- PROJECT continues to mean a folder. The new frontend Projects use INITIATIVE.
-- Keep this separate from its backfill: enum values must be committed before use.
ALTER TYPE property_entity_type ADD VALUE IF NOT EXISTS 'INITIATIVE';
