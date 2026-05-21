//! Implementation of [`CompaniesRepository`] backed by MacroDB.

#[cfg(test)]
mod test;

use crate::domain::{
    companies_repo::CompaniesRepository,
    model::{CrmCompany, CrmDomain, CrmError, DomainMetadata},
};
use sqlx::PgPool;

/// PostgreSQL-backed [`CompaniesRepository`].
#[derive(Clone)]
pub struct CompaniesRepositoryImpl {
    /// The underlying sqlx::PgPool connected to macrodb.
    pool: PgPool,
}

impl CompaniesRepositoryImpl {
    /// Creates a new instance of CompaniesRepositoryImpl
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl CompaniesRepository for CompaniesRepositoryImpl {
    #[tracing::instrument(skip(self), err)]
    async fn get_company_by_domain(
        &self,
        team_id: &uuid::Uuid,
        domain: &str,
    ) -> Result<Option<CrmCompany>, CrmError> {
        let normalized_domain = domain.to_ascii_lowercase();

        let company = sqlx::query!(
            r#"
            SELECT c.id, c.team_id, c.email_sync, c.created_at
            FROM crm_companies c
            JOIN crm_domains d ON d.company_id = c.id
            WHERE c.team_id = $1
              AND LOWER(d.domain) = $2
            LIMIT 1
            "#,
            team_id,
            normalized_domain,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        let Some(company) = company else {
            return Ok(None);
        };

        let domains = sqlx::query!(
            r#"
            SELECT id, company_id, domain, created_at
            FROM crm_domains
            WHERE company_id = $1
            ORDER BY created_at ASC
            "#,
            company.id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .into_iter()
        .map(|row| CrmDomain {
            id: row.id,
            company_id: row.company_id,
            domain: row.domain,
            created_at: row.created_at,
        })
        .collect();

        Ok(Some(CrmCompany {
            id: company.id,
            team_id: company.team_id,
            email_sync: company.email_sync,
            created_at: company.created_at,
            domains,
        }))
    }

    #[tracing::instrument(skip(self), err)]
    async fn populate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        domain: &str,
        email: &str,
        name: Option<&str>,
    ) -> Result<(), CrmError> {
        let normalized_domain = domain.to_ascii_lowercase();
        let normalized_email = email.to_ascii_lowercase();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Serialize on (team_id, lower(domain)) for the duration of this
        // transaction. Without this lock two concurrent populate_contact
        // calls can both observe "no existing company" and both insert one,
        // leaving the team with duplicate crm_companies rows. The
        // UNIQUE(team_id, LOWER(domain)) on crm_domains catches the race at
        // the second insert, but only after the first transaction has
        // already created an orphan company. The advisory lock prevents
        // that orphan from ever existing. Lock scope is the (team, domain)
        // key only — different teams/different domains run in parallel.
        sqlx::query!(
            r#"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"#,
            format!("{team_id}:{normalized_domain}"),
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Look up the company for this (team, domain). The killswitch lives
        // here: a pre-existing row with email_sync=false means the team has
        // opted this domain out and we must not write anything.
        let existing = sqlx::query!(
            r#"
            SELECT c.id, c.email_sync
            FROM crm_companies c
            JOIN crm_domains d ON d.company_id = c.id
            WHERE c.team_id = $1
              AND LOWER(d.domain) = $2
            LIMIT 1
            "#,
            team_id,
            normalized_domain,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        let company_id = match existing {
            Some(row) if !row.email_sync => {
                // Killswitch: team has opted this domain out. Commit the
                // (empty) transaction and return so the caller acks.
                tx.commit()
                    .await
                    .map_err(|e| CrmError::StorageLayerError(e.into()))?;
                return Ok(());
            }
            Some(row) => row.id,
            None => {
                let new_company = sqlx::query!(
                    r#"
                    INSERT INTO crm_companies (team_id)
                    VALUES ($1)
                    RETURNING id
                    "#,
                    team_id,
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;

                // The advisory lock guarantees no concurrent insert for the
                // same (team_id, lower(domain)). The UNIQUE index on
                // crm_domains backs that promise up — `ON CONFLICT DO
                // NOTHING` is defensive. If it does fire (e.g. an old row
                // predating the advisory lock somehow exists), the
                // crm_companies row we just inserted would be orphaned with
                // no domain pointing at it. Detect via rows_affected, look
                // up the real company id, and delete the orphan.
                let domain_insert = sqlx::query!(
                    r#"
                    INSERT INTO crm_domains (company_id, team_id, domain)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (team_id, LOWER(domain)) DO NOTHING
                    "#,
                    new_company.id,
                    team_id,
                    normalized_domain,
                )
                .execute(&mut *tx)
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;

                if domain_insert.rows_affected() == 0 {
                    let existing_company_id = sqlx::query_scalar!(
                        r#"
                        SELECT c.id
                        FROM crm_companies c
                        JOIN crm_domains d ON d.company_id = c.id
                        WHERE c.team_id = $1
                          AND LOWER(d.domain) = $2
                        LIMIT 1
                        "#,
                        team_id,
                        normalized_domain,
                    )
                    .fetch_one(&mut *tx)
                    .await
                    .map_err(|e| CrmError::StorageLayerError(e.into()))?;

                    sqlx::query!(r#"DELETE FROM crm_companies WHERE id = $1"#, new_company.id,)
                        .execute(&mut *tx)
                        .await
                        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

                    existing_company_id
                } else {
                    new_company.id
                }
            }
        };

        // Upsert the contact. `name` is supplied by the caller (the
        // backfill consumer looks it up in email_contacts before invoking
        // populate). On conflict, COALESCE preserves the existing
        // crm_contacts.name when it's non-NULL, so the first non-empty
        // name wins and a subsequent populate from a different team
        // member can't overwrite it. If the existing name is NULL
        // (previous populate ran before email_contacts had a name), the
        // conflict path still gets a chance to fill it.
        let contact_id = sqlx::query_scalar!(
            r#"
            INSERT INTO crm_contacts (company_id, email, name)
            VALUES ($1, $2, $3)
            ON CONFLICT (company_id, email) DO UPDATE
                SET name = COALESCE(crm_contacts.name, EXCLUDED.name)
            RETURNING id
            "#,
            company_id,
            normalized_email,
            name,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        sqlx::query!(
            r#"
            INSERT INTO crm_contact_sources (contact_id, link_id)
            VALUES ($1, $2)
            ON CONFLICT (contact_id, link_id) DO NOTHING
            "#,
            contact_id,
            link_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn depopulate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        domain: &str,
        email: &str,
    ) -> Result<(), CrmError> {
        let normalized_domain = domain.to_ascii_lowercase();
        let normalized_email = email.to_ascii_lowercase();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Take the lock BEFORE looking at any state. A concurrent
        // populate_contact for the same (team, domain) might have a tx
        // open that has inserted rows but hasn't committed yet — without
        // the lock our SELECT below would miss those rows, return
        // Ok(()) here, and the in-flight populate would then commit and
        // leave the team with CRM data for a since-deleted sent message.
        // Holding the lock for the rest of this tx forces populate to
        // either commit first (we then see + tear down its rows) or
        // wait until we're done (its row will be inserted after, and
        // a future depopulate will catch it).
        sqlx::query!(
            r#"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"#,
            format!("{team_id}:{normalized_domain}"),
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Resolve (contact_id, company_id, email_sync) for this
        // (team, domain, email). Returning None here means there is
        // nothing to tear down: commit the empty tx and ack.
        let Some(row) = sqlx::query!(
            r#"
            SELECT
                ct.id AS contact_id,
                co.id AS company_id,
                co.email_sync AS "email_sync!"
            FROM crm_contacts ct
            JOIN crm_companies co ON co.id = ct.company_id
            JOIN crm_domains d ON d.company_id = co.id
            WHERE co.team_id = $1
              AND LOWER(ct.email) = $2
              AND LOWER(d.domain) = $3
            LIMIT 1
            "#,
            team_id,
            normalized_email,
            normalized_domain,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        else {
            tx.commit()
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            return Ok(());
        };

        // 1. Drop the per-link source row.
        sqlx::query!(
            r#"
            DELETE FROM crm_contact_sources
            WHERE contact_id = $1 AND link_id = $2
            "#,
            row.contact_id,
            link_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // 2. Keep the contact iff any other link in the team still
        //    references it.
        let other_sources = sqlx::query_scalar!(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM crm_contact_sources WHERE contact_id = $1 LIMIT 1
            ) AS "exists!"
            "#,
            row.contact_id,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        if other_sources {
            tx.commit()
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            return Ok(());
        }

        sqlx::query!(r#"DELETE FROM crm_contacts WHERE id = $1"#, row.contact_id,)
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // 3. Keep the company when other contacts in the team still
        //    belong to it, OR when the team has opted the domain out.
        //    The killswitch (`email_sync = false`) is stored on
        //    crm_companies and is configuration, not derived data;
        //    dropping the company would silently erase the opt-out and
        //    a future populate would recreate the row with the default
        //    `email_sync = true`.
        if !row.email_sync {
            tx.commit()
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            return Ok(());
        }

        let other_contacts = sqlx::query_scalar!(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM crm_contacts WHERE company_id = $1 LIMIT 1
            ) AS "exists!"
            "#,
            row.company_id,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        if other_contacts {
            tx.commit()
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            return Ok(());
        }

        // crm_domains FK is ON DELETE CASCADE — deleting the company
        // takes its domain rows with it.
        sqlx::query!(r#"DELETE FROM crm_companies WHERE id = $1"#, row.company_id,)
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn depopulate_link_in_team(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
    ) -> Result<(), CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // 1. Drop the link's source rows scoped to this team.
        sqlx::query!(
            r#"
            DELETE FROM crm_contact_sources cs
            USING crm_contacts ct, crm_companies co
            WHERE cs.contact_id = ct.id
              AND ct.company_id = co.id
              AND co.team_id = $1
              AND cs.link_id = $2
            "#,
            team_id,
            link_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // 2. Drop every contact in this team that no longer has any
        //    source.
        sqlx::query!(
            r#"
            DELETE FROM crm_contacts ct
            USING crm_companies co
            WHERE ct.company_id = co.id
              AND co.team_id = $1
              AND NOT EXISTS (
                  SELECT 1 FROM crm_contact_sources WHERE contact_id = ct.id
              )
            "#,
            team_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // 3. Drop every company in this team that no longer has any
        //    contact AND is not killswitched. Companies with
        //    `email_sync = false` are preserved so the team's
        //    configuration survives teardown — a future populate will
        //    re-find the row and short-circuit on the same flag.
        //    `crm_domains` falls out via FK cascade.
        sqlx::query!(
            r#"
            DELETE FROM crm_companies co
            WHERE co.team_id = $1
              AND co.email_sync = TRUE
              AND NOT EXISTS (
                  SELECT 1 FROM crm_contacts WHERE company_id = co.id
              )
            "#,
            team_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn lookup_domain_metadata(
        &self,
        domain: &str,
    ) -> Result<Option<DomainMetadata>, CrmError> {
        let normalized_domain = domain.to_ascii_lowercase();
        let row = sqlx::query!(
            r#"
            SELECT name, description, icon_url
            FROM crm_domain_directory
            WHERE LOWER(domain) = $1
            LIMIT 1
            "#,
            normalized_domain,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(row.map(|r| DomainMetadata {
            name: r.name,
            description: r.description,
            icon_url: r.icon_url,
        }))
    }

    #[tracing::instrument(skip(self, metadata), err)]
    async fn upsert_domain_metadata(
        &self,
        domain: &str,
        metadata: &DomainMetadata,
    ) -> Result<(), CrmError> {
        let normalized_domain = domain.to_ascii_lowercase();
        // First-write-wins: the unique index is on `LOWER(domain)`, so
        // a concurrent populate of the same domain hits the conflict
        // path and we leave the existing row untouched (treat-as-forever
        // cache). Negative cache entries (all-NULL fields) are inserted
        // verbatim so subsequent populates suppress the resolver call.
        sqlx::query!(
            r#"
            INSERT INTO crm_domain_directory (domain, name, description, icon_url)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (LOWER(domain)) DO NOTHING
            "#,
            normalized_domain,
            metadata.name,
            metadata.description,
            metadata.icon_url,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_email_sync(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
        email_sync: bool,
    ) -> Result<(), CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Disable path takes the same per-(team, domain) advisory locks
        // populate_contact uses. Without this, a populate that already
        // passed its killswitch check could insert a contact into a
        // company we're about to disable. Sorted lookup gives a
        // deterministic lock order — populates only hold one domain lock
        // at a time, so deadlock isn't possible.
        if !email_sync {
            let domains = sqlx::query_scalar!(
                r#"
                SELECT LOWER(domain) AS "domain!"
                FROM crm_domains
                WHERE company_id = $1 AND team_id = $2
                ORDER BY LOWER(domain) ASC
                "#,
                company_id,
                team_id,
            )
            .fetch_all(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

            for domain in domains {
                sqlx::query!(
                    r#"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"#,
                    format!("{team_id}:{domain}"),
                )
                .execute(&mut *tx)
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            }
        }

        // Scoping UPDATE on both id AND team_id rejects cross-team callers as NotFound.
        let updated = sqlx::query_scalar!(
            r#"
            UPDATE crm_companies
            SET email_sync = $3
            WHERE id = $1 AND team_id = $2
            RETURNING id
            "#,
            company_id,
            team_id,
            email_sync,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        if updated.is_none() {
            return Err(CrmError::CompanyNotFoundForTeam);
        }

        if !email_sync {
            sqlx::query!(
                r#"
                DELETE FROM crm_contact_sources
                WHERE contact_id IN (
                    SELECT id FROM crm_contacts WHERE company_id = $1
                )
                "#,
                company_id,
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

            sqlx::query!(
                r#"DELETE FROM crm_contacts WHERE company_id = $1"#,
                company_id,
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        }

        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_id_for_user(&self, macro_id: &str) -> Result<Option<uuid::Uuid>, CrmError> {
        sqlx::query_scalar!(
            r#"
            SELECT team_id
            FROM team_user
            WHERE user_id = $1
            ORDER BY team_role DESC
            LIMIT 1
            "#,
            macro_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))
    }
}
