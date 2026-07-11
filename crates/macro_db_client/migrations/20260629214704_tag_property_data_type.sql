-- macro-2102: tags v0. Introduce the TAG property data type.
--
-- Isolated in its own migration on purpose: a newly added enum value cannot be
-- referenced in the same transaction that adds it, and the follow-up migration
-- creates a partial index predicated on data_type = 'TAG'.
ALTER TYPE property_data_type ADD VALUE IF NOT EXISTS 'TAG';
