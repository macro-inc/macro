CREATE TABLE IF NOT EXISTS task_initiative
(
    task_id       TEXT        PRIMARY KEY NOT NULL REFERENCES "Document" (id) ON DELETE CASCADE,
    initiative_id UUID        NOT NULL REFERENCES initiative (id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_initiative_initiative_id_idx
    ON task_initiative (initiative_id);

INSERT INTO task_initiative (task_id, initiative_id)
SELECT property.entity_id, initiative.id
FROM entity_properties AS property
JOIN "Document" AS document ON document.id = property.entity_id
JOIN initiative ON initiative.id::text = property.values->'value'->0->>'entity_id'
WHERE property.property_definition_id = '00000001-0000-0000-0000-000000000014'
ON CONFLICT (task_id) DO NOTHING;

DROP INDEX IF EXISTS idx_ep_project_value_gin;

DELETE FROM entity_properties
WHERE property_definition_id = '00000001-0000-0000-0000-000000000014';

DELETE FROM property_definitions
WHERE id = '00000001-0000-0000-0000-000000000014';
