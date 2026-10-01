-- Link existing call records to the CRM companies and contacts of the people
-- on them. New records are linked when they are archived by
-- crm::outbound::call_link::PgCallCrmLinker; this applies the same rules:
-- people are the Macro participants, the meeting owner, and the invitees of
-- the owner's calendar event carrying the meeting link; matches come from the
-- CRMs of those accounts' teams (CRM enabled), never match the team's own
-- members, and skip hidden records. Existing values are left unchanged.
WITH accounts AS (
    SELECT p.call_record_id, p.user_id
    FROM call_record_participants p
    UNION
    SELECT cr.id, m.user_id
    FROM call_records cr
    JOIN call_meetings m ON m.id = cr.meeting_id
),
emails AS (
    SELECT call_record_id, LOWER(SPLIT_PART(user_id, '|', 2)) AS email
    FROM accounts
    UNION
    SELECT cr.id, LOWER(a.email)
    FROM call_records cr
    JOIN call_meetings m ON m.id = cr.meeting_id
    JOIN calendar_events e ON e.owner_id = m.user_id
    JOIN calendar_event_attendees a ON a.event_id = e.id
    WHERE STRPOS(e.location, m.share_token) > 0
       OR STRPOS(e.description, m.share_token) > 0
       OR STRPOS(e.conference_url, m.share_token) > 0
),
teams AS (
    SELECT DISTINCT a.call_record_id, tu.team_id
    FROM accounts a
    JOIN team_user tu ON LOWER(tu.user_id) = LOWER(a.user_id)
    JOIN team_crm_settings s ON s.team_id = tu.team_id AND s.crm_enabled
),
outsiders AS (
    SELECT t.call_record_id, t.team_id, e.email, SPLIT_PART(e.email, '@', 2) AS domain
    FROM teams t
    JOIN emails e ON e.call_record_id = t.call_record_id
    WHERE STRPOS(e.email, '@') > 0
      AND NOT EXISTS (
          SELECT 1 FROM team_user tu
          WHERE tu.team_id = t.team_id AND LOWER(tu.user_id) = 'macro|' || e.email
      )
),
matches AS (
    SELECT DISTINCT o.call_record_id, co.id AS company_id, ct.id AS contact_id
    FROM outsiders o
    JOIN crm_domains d ON d.team_id = o.team_id AND LOWER(d.domain) = o.domain
    JOIN crm_companies co ON co.id = d.company_id AND NOT co.hidden
    LEFT JOIN crm_contacts ct
        ON ct.company_id = co.id AND LOWER(ct.email) = o.email AND NOT ct.hidden
),
links AS (
    SELECT call_record_id,
           '00000001-0000-0000-0000-00000000000c'::uuid AS property_definition_id, -- Companies
           jsonb_agg(DISTINCT jsonb_build_object('entity_type', 'COMPANY', 'entity_id', company_id::text)) AS refs
    FROM matches
    GROUP BY call_record_id
    UNION ALL
    SELECT call_record_id,
           '00000001-0000-0000-0000-000000000013'::uuid, -- Contacts
           jsonb_agg(DISTINCT jsonb_build_object('entity_type', 'CONTACT', 'entity_id', contact_id::text))
    FROM matches
    WHERE contact_id IS NOT NULL
    GROUP BY call_record_id
)
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
SELECT gen_random_uuid(),
       call_record_id::text,
       'CALL_RECORD'::property_entity_type,
       property_definition_id,
       jsonb_build_object('type', 'EntityReference', 'value', refs)
FROM links
ON CONFLICT (entity_id, entity_type, property_definition_id) DO NOTHING;
