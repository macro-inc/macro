-- Items whose Companies or Contacts property names a record of the activity
-- scope. $1 is the permitted team ids checked on the primary (or a verified
-- bot's team); $2 is the item kinds to return. The replica cannot grant access.
--
-- Reads only the scope's visible company and contact ids, from their team
-- indexes (companies index-only), without domains or addresses. Each id then
-- probes its property's partial GIN index (`idx_ep_companies_value_gin`,
-- `idx_ep_contacts_value_gin`) with the containment test of `property_edges`,
-- so the cost follows the scope's records, not every team's property rows. The
-- property ids are literals so the planner can use those partial indexes;
-- `test` pins them to `SystemPropertyKey`.
--
-- Bound: one probe per visible company and contact, about 2.6 us and 2.4
-- buffers each warm: 38 ms for 4k companies and 10k contacts, 1 ms for 30
-- companies. Revisit if a team's records near 40k (100 ms).
WITH scope AS MATERIALIZED (
    SELECT $1::uuid[] AS teams
), companies AS MATERIALIZED (
    -- Fence companies too so stale statistics cannot scan other teams.
    SELECT co.id, co.team_id
    FROM scope
    CROSS JOIN LATERAL (
        SELECT co.id, co.team_id
        FROM crm_companies co
        WHERE co.team_id = ANY(scope.teams) AND NOT co.hidden
        OFFSET 0
    ) co
), contacts AS MATERIALIZED (
    -- Fence the contact lookup inside the scope join so stale statistics cannot
    -- start it from every team's contacts. Apply visibility after the team lookup
    -- to avoid bitmap-reading all of `crm_contacts_visible_company_id_idx`.
    SELECT ct.id
    FROM scope
    CROSS JOIN LATERAL (
        SELECT ct.id, ct.team_id, ct.company_id, ct.hidden
        FROM crm_contacts ct
        WHERE ct.team_id = ANY(scope.teams)
        OFFSET 0
    ) ct
    WHERE NOT ct.hidden
      AND (
          ct.company_id IS NULL
          OR EXISTS (
              SELECT 1 FROM companies co
              WHERE co.id = ct.company_id AND co.team_id = ct.team_id
          )
      )
)
-- Each probe is a fenced lateral, so the records always drive: when the kind
-- filter makes the property rows look few, a plain join reads them first and
-- tests every record against every row (1.8 s for Calls on the largest team).
SELECT ep.entity_type AS "entity_type!: EntityType", ep.entity_id AS "entity_id!"
FROM companies co
CROSS JOIN LATERAL (
    SELECT ep.entity_type, ep.entity_id
    FROM entity_properties ep
    WHERE ep.property_definition_id = '00000001-0000-0000-0000-00000000000c'
      AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', co.id::text))
      AND ep.entity_type = ANY($2::property_entity_type[])
    OFFSET 0
) ep
UNION
SELECT ep.entity_type, ep.entity_id
FROM contacts ct
CROSS JOIN LATERAL (
    SELECT ep.entity_type, ep.entity_id
    FROM entity_properties ep
    WHERE ep.property_definition_id = '00000001-0000-0000-0000-000000000013'
      AND ep.values->'value' @> jsonb_build_array(jsonb_build_object('entity_id', ct.id::text))
      AND ep.entity_type = ANY($2::property_entity_type[])
    OFFSET 0
) ep
