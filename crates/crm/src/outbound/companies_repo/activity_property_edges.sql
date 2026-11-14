-- Items whose Companies or Contacts property names a record of the activity
-- scope. $1 is the viewer (every team they belong to), $2 a verified bot's
-- team; $3 the item kinds to return.
--
-- The scan starts from the Companies and Contacts property rows, which are few
-- across every team, and probes each named record by primary key, so the cost
-- does not follow the scope's record count. The property ids are literals so
-- the planner reads them from the `property_definition_id` index; `test` pins
-- them to `SystemPropertyKey`.
--
-- A reference matches exactly when the old containment test
-- `values->'value' @> [{"entity_id": "<id>"}]` would match the record's id: the
-- value is an array, the element is an object, and its `entity_id` is the id's
-- canonical lowercase text. Any other text casts to no id, and none raises.
WITH scope AS MATERIALIZED (
    SELECT ARRAY(
        SELECT tu.team_id FROM team_user tu WHERE tu.user_id = $1
        UNION ALL
        SELECT $2::uuid
    ) AS teams
), refs AS (
    SELECT ep.entity_type, ep.entity_id, ep.property_definition_id,
           (CASE WHEN ref.value->>'entity_id'
                      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                 THEN ref.value->>'entity_id' END)::uuid AS record_id
    FROM entity_properties ep
    CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(ep.values->'value') = 'array'
             THEN ep.values->'value' ELSE '[]'::jsonb END
    ) AS ref
    WHERE ep.property_definition_id IN (
            '00000001-0000-0000-0000-00000000000c',
            '00000001-0000-0000-0000-000000000013'
        )
      AND ep.entity_type = ANY($3::property_entity_type[])
)
-- A visible company of the scope.
SELECT refs.entity_type AS "entity_type!: EntityType", refs.entity_id AS "entity_id!"
FROM refs
CROSS JOIN scope
JOIN crm_companies co ON co.id = refs.record_id
WHERE refs.property_definition_id = '00000001-0000-0000-0000-00000000000c'
  AND NOT co.hidden
  AND co.team_id = ANY(scope.teams)
UNION
-- A visible contact of the scope: without a company, or under a visible
-- company of its own team.
SELECT refs.entity_type, refs.entity_id
FROM refs
CROSS JOIN scope
JOIN crm_contacts ct ON ct.id = refs.record_id
WHERE refs.property_definition_id = '00000001-0000-0000-0000-000000000013'
  AND NOT ct.hidden
  AND ct.team_id = ANY(scope.teams)
  AND (
      ct.company_id IS NULL
      OR EXISTS (
          SELECT 1
          FROM crm_companies co
          WHERE co.id = ct.company_id AND co.team_id = ct.team_id AND NOT co.hidden
      )
  )
