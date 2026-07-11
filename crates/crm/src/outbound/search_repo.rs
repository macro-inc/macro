//! Postgres implementation of [`CrmSearchRepository`].

use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::{
    model::{CrmCompany, CrmCompanyForSoup, CrmDomain, CrmError},
    search_repo::{CrmCompanyNameMatch, CrmCompanySearchCursor, CrmSearchRepository},
};

#[cfg(test)]
mod test;

/// PostgreSQL-backed [`CrmSearchRepository`].
#[derive(Clone)]
pub struct CrmSearchRepositoryImpl {
    /// Pool connected to macrodb.
    pool: PgPool,
}

impl CrmSearchRepositoryImpl {
    /// Creates a new CrmSearchRepositoryImpl.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Escapes regex metacharacters so `term` is treated literally inside the
/// highlight `regexp_replace`.
fn escape_regex(term: &str) -> String {
    const SPECIAL: &[char] = &[
        '\\', '.', '+', '*', '?', '(', ')', '[', ']', '{', '}', '^', '$', '|',
    ];
    let mut out = String::with_capacity(term.len() * 2);
    for c in term.chars() {
        if SPECIAL.contains(&c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Escapes LIKE wildcards so `term` matches literally. Relies on Postgres's
/// default `\` escape character for ILIKE, so no `ESCAPE` clause is needed.
fn escape_like(term: &str) -> String {
    let mut out = String::with_capacity(term.len() * 2);
    for c in term.chars() {
        if matches!(c, '%' | '_' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

impl CrmSearchRepository for CrmSearchRepositoryImpl {
    #[tracing::instrument(skip(self), err)]
    async fn search_company_names(
        &self,
        team_id: &Uuid,
        term: &str,
        company_ids: &[Uuid],
        hidden: Option<bool>,
        include_hidden: bool,
        limit: i64,
        cursor: Option<CrmCompanySearchCursor>,
    ) -> Result<Vec<CrmCompanyNameMatch>, CrmError> {
        let pattern = format!("%{}%", escape_like(term));
        let highlight = format!("({})", escape_regex(term));
        let cursor_ts = cursor.map(|c| c.last_updated_at);
        let cursor_id = cursor.map(|c| c.last_id);

        // Company names live in `crm_domain_directory` (keyed by domain),
        // not on `crm_companies` — so we match over both the domain string
        // and the directory name, and resolve the display name from the
        // company's primary (earliest-created) domain, mirroring
        // `list_companies_for_soup`. `$2` (hidden) defaults to visible-only
        // when NULL. The keyset guard ($7/$8) seeks past the previous page
        // under the `(updated_at DESC, id DESC)` sort; NULL = first page.
        let rows = sqlx::query!(
            r#"
            WITH matched AS (
                SELECT c.id, c.last_interaction AS updated_at
                FROM crm_companies c
                WHERE c.team_id = $1
                  AND (
                      (c.hidden = FALSE AND ($2::bool IS NULL OR $2 = FALSE))
                      OR (c.hidden = TRUE AND $2 = TRUE AND $9)
                  )
                  AND (cardinality($3::uuid[]) = 0 OR c.id = ANY($3))
                  AND EXISTS (
                      SELECT 1
                      FROM crm_domains d
                      LEFT JOIN crm_domain_directory dd
                          ON LOWER(dd.domain) = LOWER(d.domain)
                      WHERE d.company_id = c.id
                        AND (d.domain ILIKE $4 OR dd.name ILIKE $4)
                  )
                  AND ($7::timestamptz IS NULL OR (c.last_interaction, c.id) < ($7, $8))
                ORDER BY c.last_interaction DESC, c.id DESC
                LIMIT $5
            ),
            primary_domain AS (
                SELECT DISTINCT ON (d.company_id)
                    d.company_id,
                    COALESCE(dd.name, d.domain) AS display_name
                FROM crm_domains d
                LEFT JOIN crm_domain_directory dd
                    ON LOWER(dd.domain) = LOWER(d.domain)
                WHERE d.company_id IN (SELECT id FROM matched)
                ORDER BY d.company_id, d.created_at ASC NULLS LAST
            )
            SELECT
                m.id                                  AS "id!",
                COALESCE(pd.display_name, '')         AS "name!",
                regexp_replace(
                    COALESCE(pd.display_name, ''),
                    $6, '<macro_em>\1</macro_em>', 'gi'
                )                                     AS "name_highlighted!",
                m.updated_at                          AS "updated_at!"
            FROM matched m
            LEFT JOIN primary_domain pd ON pd.company_id = m.id
            ORDER BY m.updated_at DESC, m.id DESC
            "#,
            team_id,
            hidden,
            company_ids,
            pattern,
            limit,
            highlight,
            cursor_ts,
            cursor_id,
            include_hidden,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(rows
            .into_iter()
            .map(|r| CrmCompanyNameMatch {
                id: r.id,
                name: r.name,
                name_highlighted: r.name_highlighted,
                updated_at: r.updated_at,
            })
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn enrich_companies(
        &self,
        team_id: &Uuid,
        company_ids: &[Uuid],
        include_hidden: bool,
    ) -> Result<Vec<CrmCompanyForSoup>, CrmError> {
        // Batch form of `get_company_for_team`'s hydration (minus
        // contacts): one row per (company, domain), domains ordered
        // `created_at ASC` so the first row per company carries the
        // primary domain's directory name/description. `first_interaction`
        // / `last_interaction` fill the CrmCompany created_at / updated_at
        // slots — same convention as the soup listing. The outer
        // `(last_interaction DESC, id DESC)` keeps each company's rows
        // contiguous and gives a deterministic order.
        let rows = sqlx::query!(
            r#"
            SELECT
                c.id                AS "company_id!",
                c.team_id           AS "company_team_id!",
                c.email_sync        AS "company_email_sync!",
                c.hidden            AS "company_hidden!",
                c.first_interaction AS "company_created_at!",
                c.last_interaction  AS "company_updated_at!",
                d.id                AS "domain_id?",
                d.domain            AS "domain?",
                d.created_at        AS "domain_created_at?",
                dd.name             AS "dir_name?",
                dd.description      AS "dir_description?"
            FROM crm_companies c
            LEFT JOIN crm_domains d ON d.company_id = c.id
            LEFT JOIN crm_domain_directory dd
                ON LOWER(dd.domain) = LOWER(d.domain)
            WHERE c.team_id = $1
              AND c.id = ANY($2)
              AND ($3 OR c.hidden = FALSE)
            ORDER BY c.last_interaction DESC, c.id DESC, d.created_at ASC NULLS LAST
            "#,
            team_id,
            company_ids,
            include_hidden,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // First row per company carries the primary domain's directory
        // metadata; remaining rows only contribute to `domains`.
        let mut result: Vec<CrmCompanyForSoup> = Vec::new();
        for row in rows {
            let cid = row.company_id;
            if result.last().is_none_or(|c| c.company.id != cid) {
                result.push(CrmCompanyForSoup {
                    company: CrmCompany {
                        id: cid,
                        team_id: row.company_team_id,
                        email_sync: row.company_email_sync,
                        hidden: row.company_hidden,
                        created_at: row.company_created_at,
                        updated_at: row.company_updated_at,
                        domains: Vec::new(),
                    },
                    name: row.dir_name,
                    description: row.dir_description,
                    // Search results aren't resolved against per-user view
                    // history; the soup listing path supplies viewed_at.
                    viewed_at: None,
                });
            }
            // LEFT JOIN yields an all-NULL domain row for companies with
            // zero domains — skip the push then.
            if let (Some(did), Some(domain), Some(created_at)) =
                (row.domain_id, row.domain, row.domain_created_at)
            {
                result.last_mut().unwrap().company.domains.push(CrmDomain {
                    id: did,
                    company_id: cid,
                    domain,
                    created_at,
                });
            }
        }

        Ok(result)
    }
}
