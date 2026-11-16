-- One page of a company's Team list, in list_contacts_for_company's order:
-- lowercased name (the email when unnamed) ascending, unnamed-and-emailless
-- last, then id descending.
--
-- $1 company, $2 team, $3 include_hidden (admin/owner), $4 archived,
-- $5 search text ('' for none), $6/$7 the previous page's last sort name and
-- id ($7 NULL on the first page), $8 page size + 1 (the extra row says
-- whether a next page exists).
--
-- The company row proves visibility in this statement: no row back means
-- the company is not visible; one row with a NULL contact means an empty
-- page. Only the page's rows read their addresses.
WITH company AS (
    SELECT id, hidden
    FROM crm_companies
    WHERE id = $1
      AND team_id = $2
      AND ($3 OR hidden = FALSE)
),
page AS (
    SELECT
        ct.id,
        ct.company_id,
        ct.team_id,
        ct.email,
        ct.name,
        ct.hidden,
        ct.first_interaction,
        ct.last_interaction,
        ct.created_at,
        ct.updated_at,
        LOWER(COALESCE(ct.name, ct.email)) AS sort_name
    FROM company co
    JOIN crm_contacts ct ON ct.company_id = co.id
    WHERE ($3 OR ct.hidden = FALSE)
      -- Under an archived company every contact is archived.
      AND ((NOT co.hidden AND ct.hidden = $4) OR (co.hidden AND $4))
      AND (
          $5 = ''
          OR STRPOS(LOWER(ct.name), LOWER($5)) > 0
          OR STRPOS(LOWER(ct.email), LOWER($5)) > 0
      )
      AND (
          $7::uuid IS NULL
          OR (
              $6::text IS NULL
              AND LOWER(COALESCE(ct.name, ct.email)) IS NULL
              AND ct.id < $7
          )
          OR (
              $6::text IS NOT NULL
              AND (
                  LOWER(COALESCE(ct.name, ct.email)) > $6
                  OR (LOWER(COALESCE(ct.name, ct.email)) = $6 AND ct.id < $7)
                  OR LOWER(COALESCE(ct.name, ct.email)) IS NULL
              )
          )
      )
    ORDER BY LOWER(COALESCE(ct.name, ct.email)) ASC, ct.id DESC
    LIMIT $8
)
SELECT
    ct.id AS "id?",
    ct.company_id,
    ct.email,
    ct.name,
    ct.hidden AS "hidden?",
    ct.first_interaction AS "first_interaction?",
    ct.last_interaction AS "last_interaction?",
    ct.created_at AS "created_at?",
    ct.updated_at AS "updated_at?",
    ct.sort_name,
    ARRAY(
        SELECT ce.email FROM crm_contact_emails ce
        WHERE ce.contact_id = ct.id
        ORDER BY ce.email <> LOWER(BTRIM(ct.email)), ce.created_at, ce.email
    ) AS "emails!",
    ARRAY(
        SELECT ce.email FROM crm_contact_emails ce
        WHERE ce.contact_id = ct.id
          AND EXISTS (
              SELECT 1 FROM crm_domains d
              WHERE d.team_id = ct.team_id
                AND LOWER(d.domain) = split_part(ce.email, '@', 2)
                AND d.company_id = ct.company_id
          )
        ORDER BY ce.created_at, ce.email
    ) AS "company_domain_emails!"
FROM company co
LEFT JOIN page ct ON TRUE
ORDER BY ct.sort_name ASC, ct.id DESC
