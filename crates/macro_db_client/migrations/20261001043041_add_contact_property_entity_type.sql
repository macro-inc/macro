-- CRM contacts as entity-reference targets. COMPANY already means a CRM company.
-- Keep this separate from the seed: enum values must be committed before use.
ALTER TYPE property_entity_type ADD VALUE IF NOT EXISTS 'CONTACT';
