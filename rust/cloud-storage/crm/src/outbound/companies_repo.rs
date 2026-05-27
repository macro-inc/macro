//! Implementation of [`CompaniesRepository`] backed by MacroDB.

#[cfg(test)]
mod test;

use crate::domain::{
    companies_repo::CompaniesRepository,
    model::{
        CrmAddressStatus, CrmCompany, CrmDomain, CrmDomainStatus, CrmError, CrmScopePrecheck,
        DomainMetadata,
    },
};
use chrono::{DateTime, Utc};
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

    /// Take per-`(team_id, lower(domain))` advisory locks for every
    /// domain on the company, sorted — same scheme `populate_contact` /
    /// `depopulate_contact` use, sorted order prevents deadlock.
    async fn lock_company_domains(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
    ) -> Result<(), CrmError> {
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
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        for domain in domains {
            sqlx::query!(
                r#"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"#,
                format!("{team_id}:{domain}"),
            )
            .execute(&mut **tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        }

        Ok(())
    }

    /// Drop the company's sources then contacts. Caller must hold the
    /// per-domain advisory locks (see [`Self::lock_company_domains`]).
    async fn delete_company_contacts(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        company_id: &uuid::Uuid,
    ) -> Result<(), CrmError> {
        sqlx::query!(
            r#"
            DELETE FROM crm_contact_sources
            WHERE contact_id IN (
                SELECT id FROM crm_contacts WHERE company_id = $1
            )
            "#,
            company_id,
        )
        .execute(&mut **tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        sqlx::query!(
            r#"DELETE FROM crm_contacts WHERE company_id = $1"#,
            company_id,
        )
        .execute(&mut **tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(())
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
            SELECT c.id, c.team_id, c.email_sync, c.hidden, c.created_at, c.updated_at
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
            hidden: company.hidden,
            created_at: company.created_at,
            updated_at: company.updated_at,
            domains,
        }))
    }

    #[tracing::instrument(skip(self), err)]
    #[allow(clippy::too_many_arguments)]
    async fn populate_contact(
        &self,
        team_id: &uuid::Uuid,
        link_id: &uuid::Uuid,
        domain: &str,
        email: &str,
        name: Option<&str>,
        first_at: DateTime<Utc>,
        last_at: DateTime<Utc>,
        is_sent: bool,
    ) -> Result<(), CrmError> {
        let normalized_domain = domain.to_ascii_lowercase();
        let normalized_email = email.to_ascii_lowercase();

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Serialize on (team, lower(domain)): the unique constraint on
        // crm_domains catches the race only after an orphan crm_companies
        // row was already inserted by the loser.
        sqlx::query!(
            r#"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"#,
            format!("{team_id}:{normalized_domain}"),
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Team killswitch. Read inside the tx (after the lock) so a
        // concurrent disable+purge can't race past us. Missing row =
        // default false.
        let team_crm_enabled = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(
                (SELECT crm_enabled FROM team_crm_settings WHERE team_id = $1),
                FALSE
            ) AS "crm_enabled!"
            "#,
            team_id,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        if !team_crm_enabled {
            tx.commit()
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            return Ok(());
        }

        // Per-domain killswitch: existing row with email_sync=false
        // means the team has opted this domain out, no-op.
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
                // Killswitch: domain opted out, ack and exit.
                tx.commit()
                    .await
                    .map_err(|e| CrmError::StorageLayerError(e.into()))?;
                return Ok(());
            }
            Some(row) => {
                // `last_interaction` always bumps via GREATEST.
                // `first_interaction` only LEAST-merges on is_sent=true:
                // received-direction populates must not pull the anchor
                // backwards.
                sqlx::query!(
                    r#"UPDATE crm_companies
                       SET updated_at = now(),
                           first_interaction = CASE
                               WHEN $4 THEN LEAST(first_interaction, $2)
                               ELSE first_interaction
                           END,
                           last_interaction = GREATEST(last_interaction, $3)
                       WHERE id = $1"#,
                    row.id,
                    first_at,
                    last_at,
                    is_sent,
                )
                .execute(&mut *tx)
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;

                row.id
            }
            None if !is_sent => {
                // Received-direction never creates a company row.
                tx.commit()
                    .await
                    .map_err(|e| CrmError::StorageLayerError(e.into()))?;
                return Ok(());
            }
            None => {
                // Seed interaction columns from the producer's known
                // range so backfilled mail keeps accurate timestamps.
                let new_company = sqlx::query!(
                    r#"
                    INSERT INTO crm_companies (team_id, first_interaction, last_interaction)
                    VALUES ($1, $2, $3)
                    RETURNING id
                    "#,
                    team_id,
                    first_at,
                    last_at,
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;

                // Defensive ON CONFLICT — the advisory lock should
                // prevent it, but if it fires we'd orphan the company
                // we just inserted, so we recover via rows_affected.
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

                    // is_sent is true here (the !is_sent arm exited);
                    // CASE kept for symmetry with the regular path.
                    sqlx::query!(
                        r#"UPDATE crm_companies
                           SET updated_at = now(),
                               first_interaction = CASE
                                   WHEN $4 THEN LEAST(first_interaction, $2)
                                   ELSE first_interaction
                               END,
                               last_interaction = GREATEST(last_interaction, $3)
                           WHERE id = $1"#,
                        existing_company_id,
                        first_at,
                        last_at,
                        is_sent,
                    )
                    .execute(&mut *tx)
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

        // First non-NULL name wins (COALESCE preserves existing).
        // `last_interaction` always GREATEST; `first_interaction`
        // LEAST-merges only on is_sent=true (mirrors company rule).
        let contact_id = sqlx::query_scalar!(
            r#"
            INSERT INTO crm_contacts (company_id, email, name, first_interaction, last_interaction)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (company_id, email) DO UPDATE
                SET name = COALESCE(crm_contacts.name, EXCLUDED.name),
                    updated_at = now(),
                    first_interaction = CASE
                        WHEN $6 THEN LEAST(crm_contacts.first_interaction, EXCLUDED.first_interaction)
                        ELSE crm_contacts.first_interaction
                    END,
                    last_interaction = GREATEST(crm_contacts.last_interaction, EXCLUDED.last_interaction)
            RETURNING id
            "#,
            company_id,
            normalized_email,
            name,
            first_at,
            last_at,
            is_sent,
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

        // Lock BEFORE observing state: a concurrent populate could
        // commit rows for a since-deleted sent message otherwise.
        sqlx::query!(
            r#"SELECT pg_advisory_xact_lock(hashtextextended($1, 0))"#,
            format!("{team_id}:{normalized_domain}"),
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // None here = nothing to tear down.
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

        // 3. Keep killswitched companies — dropping would erase the
        //    opt-out and a future populate would recreate as enabled.
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

        // crm_domains cascades via FK.
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

        // 3. Drop orphan non-killswitched companies. crm_domains
        //    cascades via FK.
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
        // First-write-wins. Negative cache entries (all-NULL) are
        // preserved to suppress future resolver calls.
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

        if !email_sync {
            // Hold the same per-domain locks populate_contact takes so
            // an in-flight populate can't slip past our killswitch.
            Self::lock_company_domains(&mut tx, team_id, company_id).await?;
        } else {
            // Refuse enable on hidden — populate would recreate under a
            // hidden company. FOR UPDATE blocks concurrent hide.
            let row = sqlx::query!(
                r#"
                SELECT hidden
                FROM crm_companies
                WHERE id = $1 AND team_id = $2
                FOR UPDATE
                "#,
                company_id,
                team_id,
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

            let Some(row) = row else {
                return Err(CrmError::CompanyNotFoundForTeam);
            };
            if row.hidden {
                return Err(CrmError::CompanyHidden);
            }
        }

        // Scoping on (id, team_id) rejects cross-team as NotFound.
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
            Self::delete_company_contacts(&mut tx, company_id).await?;
        }

        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_company_hidden(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
        hidden: bool,
    ) -> Result<(), CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        if hidden {
            // Hiding implies email_sync=false; flip both atomically.
            // Domain locks block in-flight populates past their
            // killswitch check.
            Self::lock_company_domains(&mut tx, team_id, company_id).await?;

            // Scoping UPDATE on both id AND team_id rejects cross-team callers as NotFound.
            let updated = sqlx::query_scalar!(
                r#"
                UPDATE crm_companies
                SET hidden = TRUE, email_sync = FALSE
                WHERE id = $1 AND team_id = $2
                RETURNING id
                "#,
                company_id,
                team_id,
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

            if updated.is_none() {
                return Err(CrmError::CompanyNotFoundForTeam);
            }

            Self::delete_company_contacts(&mut tx, company_id).await?;
        } else {
            // Un-hide leaves email_sync alone; re-enable is separate.
            let updated = sqlx::query_scalar!(
                r#"
                UPDATE crm_companies
                SET hidden = FALSE
                WHERE id = $1 AND team_id = $2
                RETURNING id
                "#,
                company_id,
                team_id,
            )
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

            if updated.is_none() {
                return Err(CrmError::CompanyNotFoundForTeam);
            }
        }

        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn set_contact_hidden(
        &self,
        team_id: &uuid::Uuid,
        contact_id: &uuid::Uuid,
        hidden: bool,
    ) -> Result<(), CrmError> {
        // Scope via the contact's company; cross-team = NotFound.
        let updated = sqlx::query_scalar!(
            r#"
            UPDATE crm_contacts ct
            SET hidden = $3
            FROM crm_companies co
            WHERE ct.id = $1
              AND ct.company_id = co.id
              AND co.team_id = $2
            RETURNING ct.id
            "#,
            contact_id,
            team_id,
            hidden,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        if updated.is_none() {
            return Err(CrmError::ContactNotFoundForTeam);
        }

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

    #[tracing::instrument(skip(self), err)]
    async fn crm_scope_precheck(
        &self,
        team_id: &uuid::Uuid,
        domains: &[String],
        addresses: &[String],
    ) -> Result<CrmScopePrecheck, CrmError> {
        // Killswitch read: a missing row is treated as `crm_enabled = false`.
        let crm_enabled: bool = sqlx::query_scalar!(
            r#"SELECT crm_enabled FROM team_crm_settings WHERE team_id = $1"#,
            team_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .unwrap_or(false);

        // Killswitch off: caller rejects with CrmDisabledForTeam, so
        // skip the per-input probes.
        if !crm_enabled {
            return Ok(CrmScopePrecheck {
                crm_enabled: false,
                domains: Vec::new(),
                addresses: Vec::new(),
            });
        }

        let domain_statuses: Vec<CrmDomainStatus> = if domains.is_empty() {
            Vec::new()
        } else {
            // `WITH ORDINALITY` + `ORDER BY input.ord` preserves the
            // input order (contract on `CrmScopePrecheck.domains`).
            sqlx::query!(
                r#"
                SELECT
                    input.domain                       AS "domain!",
                    (d.id IS NOT NULL)                 AS "exists!",
                    COALESCE(c.hidden, FALSE)          AS "company_hidden!",
                    COALESCE(c.email_sync, FALSE)      AS "email_sync!"
                FROM UNNEST($2::text[]) WITH ORDINALITY AS input(domain, ord)
                LEFT JOIN crm_domains d
                    ON d.team_id = $1 AND LOWER(d.domain) = input.domain
                LEFT JOIN crm_companies c
                    ON c.id = d.company_id
                ORDER BY input.ord
                "#,
                team_id,
                domains,
            )
            .fetch_all(&self.pool)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?
            .into_iter()
            .map(|r| CrmDomainStatus {
                domain: r.domain,
                exists: r.exists,
                company_hidden: r.company_hidden,
                email_sync: r.email_sync,
            })
            .collect()
        };

        let address_statuses: Vec<CrmAddressStatus> = if addresses.is_empty() {
            Vec::new()
        } else {
            // Hash-join via derived table (avoids LATERAL per-row).
            // At most one row per (team, email) by virtue of
            // crm_contacts UNIQUE(company_id, email) +
            // crm_domains UNIQUE(team_id, lower(domain)).
            // ORDER BY input.ord preserves input order
            // (contract on `CrmScopePrecheck.addresses`).
            sqlx::query!(
                r#"
                SELECT
                    input.address                          AS "address!",
                    (m.email IS NOT NULL)                  AS "exists!",
                    COALESCE(m.contact_hidden, FALSE)      AS "contact_hidden!",
                    COALESCE(m.company_hidden, FALSE)      AS "company_hidden!",
                    COALESCE(m.email_sync,     FALSE)      AS "email_sync!"
                FROM UNNEST($2::text[]) WITH ORDINALITY AS input(address, ord)
                LEFT JOIN (
                    SELECT
                        ct.email     AS email,
                        ct.hidden    AS contact_hidden,
                        c.hidden     AS company_hidden,
                        c.email_sync AS email_sync
                    FROM crm_contacts ct
                    JOIN crm_companies c ON c.id = ct.company_id
                    WHERE c.team_id = $1
                ) m ON m.email = input.address
                ORDER BY input.ord
                "#,
                team_id,
                addresses,
            )
            .fetch_all(&self.pool)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?
            .into_iter()
            .map(|r| CrmAddressStatus {
                address: r.address,
                exists: r.exists,
                contact_hidden: r.contact_hidden,
                company_hidden: r.company_hidden,
                email_sync: r.email_sync,
            })
            .collect()
        };

        Ok(CrmScopePrecheck {
            crm_enabled,
            domains: domain_statuses,
            addresses: address_statuses,
        })
    }
}
