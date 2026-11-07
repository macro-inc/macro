-- Raw keyset pages precede every eligibility predicate. Misses and drafts also
-- advance the cursor, so an absent match never walks the mailbox in one query.
WITH threads AS MATERIALIZED (
    SELECT id, COALESCE(latest_non_spam_message_ts,updated_at) AS sort_ts
    FROM email_threads WHERE link_id=$3
      AND (COALESCE(latest_non_spam_message_ts,updated_at),id)
          < (COALESCE($4::timestamptz,'infinity'),COALESCE($5::uuid,'ffffffff-ffff-ffff-ffff-ffffffffffff'))
    ORDER BY COALESCE(latest_non_spam_message_ts,updated_at) DESC,id DESC LIMIT 100
), actor AS MATERIALIZED (
    SELECT team_role<>'member' AS admin FROM team_user WHERE team_id=$1 AND user_id=$2
), policies AS MATERIALIZED (
    SELECT FALSE AS proposed,c.enabled OR c.selected_enabled AS enabled,c.mode,
           COALESCE(r.definition,'{"schema_version":1,"include":[]}'::jsonb) AS definition
    FROM crm_email_consent c LEFT JOIN LATERAL (
        SELECT definition,link_id FROM crm_email_rule_revisions
        WHERE c.active_rule_revision IS NOT NULL
            AND (team_id,user_id,revision) BETWEEN
                (c.team_id,c.user_id,c.active_rule_revision)
                AND (c.team_id,c.user_id,c.active_rule_revision)
        ORDER BY team_id,user_id,revision LIMIT 1 OFFSET 0
    ) r ON r.link_id=c.link_id
    WHERE c.team_id=$1 AND c.user_id=$2 AND c.link_id=$3
    UNION ALL SELECT TRUE,TRUE,'selected',$6::jsonb
), rules AS MATERIALIZED (
    SELECT p.proposed,entry AS target,entry->>'kind' AS kind
    FROM policies p CROSS JOIN LATERAL jsonb_array_elements(p.definition->'include') entry
    WHERE p.mode='selected'
), raw_participants AS MATERIALIZED (
    SELECT t.id AS thread_id,lower(ec.email_address) AS address,
           lower(split_part(ec.email_address,'@',2)) AS domain
    FROM threads t CROSS JOIN LATERAL (
        SELECT from_contact_id FROM email_messages WHERE thread_id=t.id AND NOT is_draft OFFSET 0
    ) m CROSS JOIN LATERAL (
        SELECT email_address FROM email_contacts WHERE id=m.from_contact_id OFFSET 0
    ) ec
    UNION ALL
    SELECT t.id,lower(ec.email_address),lower(split_part(ec.email_address,'@',2))
    FROM threads t CROSS JOIN LATERAL (
        SELECT id FROM email_messages WHERE thread_id=t.id AND NOT is_draft OFFSET 0
    ) m CROSS JOIN LATERAL (
        SELECT contact_id FROM email_message_recipients WHERE message_id=m.id OFFSET 0
    ) r CROSS JOIN LATERAL (
        SELECT email_address FROM email_contacts WHERE id=r.contact_id OFFSET 0
    ) ec
), participants AS MATERIALIZED (
    -- Repeated messages from the same address need one eligibility probe. Both
    -- this distinct set and the domain checks are bounded by the raw page.
    SELECT DISTINCT thread_id,address,domain FROM raw_participants
), blocked_domains AS MATERIALIZED (
    SELECT domain FROM (SELECT DISTINCT domain FROM participants OFFSET 0) d
    WHERE crm_email_domain_blocked($1,$2,d.domain)
), contacts AS MATERIALIZED (
    SELECT r.proposed,ct.id FROM rules r CROSS JOIN actor
    CROSS JOIN LATERAL (
        SELECT id,team_id,company_id,hidden FROM crm_contacts
        WHERE id=(r.target->>'contact_id')::uuid OFFSET 0
    ) ct LEFT JOIN LATERAL (
        SELECT team_id,hidden FROM crm_companies WHERE id=ct.company_id OFFSET 0
    ) co ON TRUE
    WHERE r.kind='contact' AND ct.team_id=$1 AND (NOT ct.hidden OR actor.admin)
      AND (ct.company_id IS NULL OR (co.team_id=$1 AND (NOT co.hidden OR actor.admin)))
), companies AS MATERIALIZED (
    SELECT r.proposed,co.id FROM rules r CROSS JOIN actor
    CROSS JOIN LATERAL (
        SELECT id,team_id,hidden FROM crm_companies WHERE id=(r.target->>'company_id')::uuid OFFSET 0
    ) co WHERE r.kind='company' AND co.team_id=$1 AND (NOT co.hidden OR actor.admin)
), thread_facts AS MATERIALIZED (
    SELECT t.id,t.sort_ts,
        EXISTS(SELECT 1 FROM email_messages WHERE thread_id=t.id AND NOT is_draft) AS has_message,
        crm_email_thread_excluded($1,$2,$3,t.id)
          OR EXISTS(SELECT 1 FROM participants part JOIN blocked_domains blocked USING(domain)
                    WHERE part.thread_id=t.id) AS denied
    FROM threads t
), matches AS MATERIALIZED (
    SELECT t.id,t.sort_ts,t.denied,p.proposed,
        p.enabled AND t.has_message AND (
            p.mode='all'
            OR EXISTS(SELECT 1 FROM rules r WHERE r.proposed=p.proposed AND r.kind='thread'
                      AND (r.target->>'thread_id')::uuid=t.id)
            OR EXISTS(
                SELECT 1 FROM (
                    SELECT address,domain FROM participants WHERE thread_id=t.id OFFSET 0
                ) part WHERE (
                    EXISTS(SELECT 1 FROM rules r WHERE r.proposed=p.proposed AND r.kind='address'
                           AND r.target->>'address'=part.address)
                    OR EXISTS(
                        SELECT 1 FROM contacts ct CROSS JOIN LATERAL (
                            SELECT 1 FROM crm_contact_emails ce
                            WHERE (ce.contact_id,ce.email) BETWEEN (ct.id,part.address) AND (ct.id,part.address)
                            OFFSET 0
                        ) found WHERE ct.proposed=p.proposed
                    )
                    OR EXISTS(
                        SELECT 1 FROM (
                            SELECT part.domain AS suffix
                            UNION ALL SELECT substr(part.domain,dot+1)
                            FROM generate_series(1,length(part.domain)) dot WHERE substr(part.domain,dot,1)='.'
                        ) suffix WHERE
                            EXISTS(SELECT 1 FROM rules r WHERE r.proposed=p.proposed AND r.kind='domain'
                                   AND r.target->>'domain'=suffix.suffix)
                            OR EXISTS(
                                SELECT 1 FROM crm_domains d WHERE d.team_id=$1 AND lower(d.domain)=suffix.suffix
                                  AND d.company_id=ANY(ARRAY(SELECT id FROM companies co WHERE co.proposed=p.proposed))
                            )
                    )
                )
            )
        ) AS matched
    FROM thread_facts t CROSS JOIN policies p
)
SELECT id AS "id!",sort_ts AS "sort_ts!",
    COALESCE(bool_or(matched AND NOT denied) FILTER(WHERE NOT proposed),FALSE) AS "current!",
    COALESCE(bool_or(matched AND NOT denied) FILTER(WHERE proposed),FALSE) AS "proposed!",
    COALESCE(bool_or(matched AND denied) FILTER(WHERE proposed),FALSE) AS "denied!"
FROM matches GROUP BY id,sort_ts ORDER BY sort_ts DESC,id DESC
