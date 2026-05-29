//! Implementation of [`CompaniesRepository`] backed by MacroDB.

#[cfg(test)]
mod test;

use crate::domain::{
    comment::{
        CrmComment, CrmCommentEntityType, CrmCommentThread, CrmThread, DeleteCrmCommentResult,
    },
    companies_repo::{CompaniesRepository, CrmCompanyListSort, CrmCompanySoupCursor},
    model::{
        CrmAddressStatus, CrmCompany, CrmCompanyForSoup, CrmContact, CrmDomain, CrmDomainStatus,
        CrmError, CrmScopePrecheck, DomainMetadata,
    },
};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

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
            SELECT
                name, description, icon_url,
                apollo_organization_id, website_url, linkedin_url, twitter_url,
                facebook_url, industry, keywords, technologies,
                estimated_num_employees, annual_revenue, annual_revenue_printed,
                total_funding, total_funding_printed, latest_funding_stage,
                latest_funding_round_date, founded_year, publicly_traded_symbol,
                publicly_traded_exchange, phone, raw_address, street_address,
                city, state, postal_code, country, raw
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
            apollo_organization_id: r.apollo_organization_id,
            website_url: r.website_url,
            linkedin_url: r.linkedin_url,
            twitter_url: r.twitter_url,
            facebook_url: r.facebook_url,
            industry: r.industry,
            keywords: r.keywords.unwrap_or_default(),
            technologies: r.technologies.unwrap_or_default(),
            estimated_num_employees: r.estimated_num_employees,
            annual_revenue: r.annual_revenue,
            annual_revenue_printed: r.annual_revenue_printed,
            total_funding: r.total_funding,
            total_funding_printed: r.total_funding_printed,
            latest_funding_stage: r.latest_funding_stage,
            latest_funding_round_date: r.latest_funding_round_date,
            founded_year: r.founded_year,
            publicly_traded_symbol: r.publicly_traded_symbol,
            publicly_traded_exchange: r.publicly_traded_exchange,
            phone: r.phone,
            raw_address: r.raw_address,
            street_address: r.street_address,
            city: r.city,
            state: r.state,
            postal_code: r.postal_code,
            country: r.country,
            raw: r.raw,
        }))
    }

    #[tracing::instrument(skip(self, metadata), err)]
    async fn upsert_domain_metadata(
        &self,
        domain: &str,
        metadata: &DomainMetadata,
    ) -> Result<(), CrmError> {
        let normalized_domain = domain.to_ascii_lowercase();
        // First-write-wins. All-empty rows are negative-cache entries that
        // suppress future resolver calls; `enriched_at` stamps resolve time.
        sqlx::query!(
            r#"
            INSERT INTO crm_domain_directory (
                domain, name, description, icon_url,
                apollo_organization_id, website_url, linkedin_url, twitter_url,
                facebook_url, industry, keywords, technologies,
                estimated_num_employees, annual_revenue, annual_revenue_printed,
                total_funding, total_funding_printed, latest_funding_stage,
                latest_funding_round_date, founded_year, publicly_traded_symbol,
                publicly_traded_exchange, phone, raw_address, street_address,
                city, state, postal_code, country, raw, enriched_at
            )
            VALUES (
                $1, $2, $3, $4,
                $5, $6, $7, $8,
                $9, $10, $11, $12,
                $13, $14, $15,
                $16, $17, $18,
                $19, $20, $21,
                $22, $23, $24, $25,
                $26, $27, $28, $29, $30, now()
            )
            ON CONFLICT (LOWER(domain)) DO NOTHING
            "#,
            normalized_domain,
            metadata.name,
            metadata.description,
            metadata.icon_url,
            metadata.apollo_organization_id,
            metadata.website_url,
            metadata.linkedin_url,
            metadata.twitter_url,
            metadata.facebook_url,
            metadata.industry,
            &metadata.keywords,
            &metadata.technologies,
            metadata.estimated_num_employees,
            metadata.annual_revenue,
            metadata.annual_revenue_printed,
            metadata.total_funding,
            metadata.total_funding_printed,
            metadata.latest_funding_stage,
            metadata.latest_funding_round_date,
            metadata.founded_year,
            metadata.publicly_traded_symbol,
            metadata.publicly_traded_exchange,
            metadata.phone,
            metadata.raw_address,
            metadata.street_address,
            metadata.city,
            metadata.state,
            metadata.postal_code,
            metadata.country,
            metadata.raw,
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

    #[tracing::instrument(skip(self), err)]
    async fn list_companies_for_soup(
        &self,
        team_id: &uuid::Uuid,
        company_ids: &[uuid::Uuid],
        hidden: Option<bool>,
        sort: CrmCompanyListSort,
        cursor: Option<CrmCompanySoupCursor>,
        limit: i64,
    ) -> Result<Vec<CrmCompanyForSoup>, CrmError> {
        let sort_method_str = match sort {
            CrmCompanyListSort::UpdatedAt => "updated_at",
            CrmCompanyListSort::CreatedAt => "created_at",
        };
        // Keyset seek past the previous soup page's last row. Compared as
        // (sort_ts, id::text) to match the main soup query's tiebreak in
        // pg_soup_repo/expanded/by_cursor.rs. NULL = first page.
        let cursor_ts = cursor.map(|c| c.last_sort_ts);
        let cursor_id = cursor.map(|c| c.last_id.to_string());

        // CTE limits companies before the domain/directory joins; the
        // outer ORDER BY repeats the CTE's sort + `d.created_at ASC`
        // so rows arrive contiguous per company with the primary
        // domain first. Sort columns are `first_interaction` /
        // `last_interaction` from populate_contact (both NOT NULL —
        // see the `crm_interaction_timestamps` migration).
        //
        // `$5` (`hidden`) defaults to visible-only when `NULL`; the
        // admin/owner role check for `Some(true)` is enforced upstream
        // in soup's axum router.
        let rows = sqlx::query!(
            r#"
            WITH limited_companies AS (
                SELECT
                    c.id,
                    c.team_id,
                    c.email_sync,
                    c.hidden,
                    c.first_interaction,
                    c.last_interaction
                FROM crm_companies c
                WHERE c.team_id = $1
                  AND c.hidden = COALESCE($5::bool, FALSE)
                  AND EXISTS (
                      SELECT 1 FROM team_crm_settings tcs
                      WHERE tcs.team_id = $1 AND tcs.crm_enabled
                  )
                  AND (cardinality($2::uuid[]) = 0 OR c.id = ANY($2::uuid[]))
                  -- Keyset seek (NULL = first page): keep only rows that
                  -- sort strictly after the cursor.
                  AND (
                      $6::timestamptz IS NULL
                      OR (
                          CASE $4
                              WHEN 'created_at' THEN c.first_interaction
                              ELSE c.last_interaction
                          END,
                          c.id::text
                      ) < ($6, $7)
                  )
                ORDER BY
                    CASE $4
                        WHEN 'created_at' THEN c.first_interaction
                        ELSE c.last_interaction
                    END DESC,
                    c.id DESC
                LIMIT $3
            )
            SELECT
                lc.id                AS "company_id!",
                lc.team_id           AS "company_team_id!",
                lc.email_sync        AS "company_email_sync!",
                lc.hidden            AS "company_hidden!",
                lc.first_interaction AS "company_created_at!",
                lc.last_interaction  AS "company_updated_at!",
                d.id                 AS "domain_id?",
                d.domain             AS "domain?",
                d.created_at       AS "domain_created_at?",
                dd.name            AS "dir_name?",
                dd.description     AS "dir_description?"
            FROM limited_companies lc
            LEFT JOIN crm_domains d ON d.company_id = lc.id
            LEFT JOIN crm_domain_directory dd
                ON LOWER(dd.domain) = LOWER(d.domain)
            ORDER BY
                CASE $4
                    WHEN 'created_at' THEN lc.first_interaction
                    ELSE lc.last_interaction
                END DESC,
                lc.id DESC,
                d.created_at ASC NULLS LAST
            "#,
            team_id,
            company_ids,
            limit,
            sort_method_str,
            hidden,
            cursor_ts,
            cursor_id,
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
                });
            }
            // LEFT JOIN gives an all-NULL domain row for companies with
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

    #[tracing::instrument(skip(self), err)]
    async fn list_contacts_for_company(
        &self,
        team_id: &uuid::Uuid,
        company_id: &uuid::Uuid,
    ) -> Result<Vec<CrmContact>, CrmError> {
        // Authorize first: a company id that isn't the team's must be
        // indistinguishable from one that doesn't exist, so we 404
        // rather than returning an empty list (which would confirm the
        // id belongs to another team).
        let owns_company = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM crm_companies
                WHERE id = $1 AND team_id = $2
            ) AS "exists!"
            "#,
            company_id,
            team_id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        if !owns_company {
            return Err(CrmError::CompanyNotFoundForTeam);
        }

        let rows = sqlx::query!(
            r#"
            SELECT
                id,
                company_id,
                email,
                name,
                first_interaction,
                last_interaction,
                created_at,
                updated_at
            FROM crm_contacts
            WHERE company_id = $1
              AND hidden = FALSE
            ORDER BY LOWER(COALESCE(name, email)) ASC, id DESC
            "#,
            company_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(rows
            .into_iter()
            .map(|row| CrmContact {
                id: row.id,
                company_id: row.company_id,
                email: row.email,
                name: row.name,
                first_interaction: row.first_interaction,
                last_interaction: row.last_interaction,
                created_at: row.created_at,
                updated_at: row.updated_at,
            })
            .collect())
    }

    #[tracing::instrument(skip(self, thread_metadata, text, metadata), err, fields(entity_id = %entity_id))]
    async fn create_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        entity_type: CrmCommentEntityType,
        entity_id: &uuid::Uuid,
        owner: &str,
        thread_id: Option<uuid::Uuid>,
        thread_metadata: Option<Value>,
        text: &str,
        metadata: Option<Value>,
    ) -> Result<CrmCommentThread, CrmError> {
        // Exactly one parent column is set; the CHECK constraint enforces it.
        let (company_id, contact_id) = match entity_type {
            CrmCommentEntityType::CrmCompany => (Some(*entity_id), None),
            CrmCommentEntityType::CrmContact => (None, Some(*entity_id)),
        };

        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Authorize: the entity must belong to the requesting team. Done
        // in-tx so a concurrent teardown can't slip a delete past us.
        if !entity_owned_by_team(&mut *tx, team_id, entity_type, entity_id).await? {
            return Err(entity_not_found_err(entity_type));
        }

        // Resolve the target thread: reuse the supplied one (after checking
        // it belongs to this entity and isn't deleted) or open a new one.
        let thread_id = match thread_id {
            Some(tid) => {
                let belongs = sqlx::query_scalar!(
                    r#"
                    SELECT EXISTS (
                        SELECT 1 FROM crm_thread
                        WHERE id = $1
                          AND deleted_at IS NULL
                          AND (company_id = $2 OR contact_id = $3)
                    ) AS "exists!"
                    "#,
                    tid,
                    company_id,
                    contact_id,
                )
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
                if !belongs {
                    return Err(CrmError::ThreadNotFound);
                }
                // Bump updated_at; replace metadata only when one is supplied.
                sqlx::query!(
                    r#"
                    UPDATE crm_thread
                    SET updated_at = now(), metadata = COALESCE($2, metadata)
                    WHERE id = $1
                    "#,
                    tid,
                    thread_metadata,
                )
                .execute(&mut *tx)
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
                tid
            }
            None => sqlx::query_scalar!(
                r#"
                INSERT INTO crm_thread (company_id, contact_id, owner, metadata)
                VALUES ($1, $2, $3, $4)
                RETURNING id
                "#,
                company_id,
                contact_id,
                owner,
                thread_metadata,
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?,
        };

        sqlx::query!(
            r#"
            INSERT INTO crm_comment (thread_id, owner, text, metadata)
            VALUES ($1, $2, $3, $4)
            "#,
            thread_id,
            owner,
            text,
            metadata,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Re-read the full thread (with all comments) to return.
        let row = sqlx::query!(
            r#"
            SELECT id, company_id, contact_id, owner, resolved, metadata,
                   created_at, updated_at, deleted_at
            FROM crm_thread
            WHERE id = $1
            "#,
            thread_id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        let thread = CrmThread {
            thread_id: row.id,
            entity_type,
            entity_id: *entity_id,
            owner: row.owner,
            resolved: row.resolved,
            metadata: row.metadata,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        };
        let comments = fetch_comments_for_threads(&self.pool, &[thread_id]).await?;
        Ok(CrmCommentThread { thread, comments })
    }

    #[tracing::instrument(skip(self), err, fields(entity_id = %entity_id))]
    async fn get_crm_comment_threads(
        &self,
        team_id: &uuid::Uuid,
        entity_type: CrmCommentEntityType,
        entity_id: &uuid::Uuid,
    ) -> Result<Vec<CrmCommentThread>, CrmError> {
        if !entity_owned_by_team(&self.pool, team_id, entity_type, entity_id).await? {
            return Err(entity_not_found_err(entity_type));
        }

        let (company_id, contact_id) = match entity_type {
            CrmCommentEntityType::CrmCompany => (Some(*entity_id), None),
            CrmCommentEntityType::CrmContact => (None, Some(*entity_id)),
        };

        let thread_rows = sqlx::query!(
            r#"
            SELECT id, owner, resolved, metadata, created_at, updated_at, deleted_at
            FROM crm_thread
            WHERE (company_id = $1 OR contact_id = $2)
              AND deleted_at IS NULL
            ORDER BY created_at ASC, id ASC
            "#,
            company_id,
            contact_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        let threads: Vec<CrmThread> = thread_rows
            .into_iter()
            .map(|row| CrmThread {
                thread_id: row.id,
                entity_type,
                entity_id: *entity_id,
                owner: row.owner,
                resolved: row.resolved,
                metadata: row.metadata,
                created_at: row.created_at,
                updated_at: row.updated_at,
                deleted_at: row.deleted_at,
            })
            .collect();

        let thread_ids: Vec<Uuid> = threads.iter().map(|t| t.thread_id).collect();
        let comments = fetch_comments_for_threads(&self.pool, &thread_ids).await?;

        let mut by_thread: HashMap<Uuid, Vec<CrmComment>> = HashMap::new();
        for comment in comments {
            by_thread
                .entry(comment.thread_id)
                .or_default()
                .push(comment);
        }

        Ok(threads
            .into_iter()
            .map(|thread| {
                let comments = by_thread.remove(&thread.thread_id).unwrap_or_default();
                CrmCommentThread { thread, comments }
            })
            .collect())
    }

    #[tracing::instrument(skip(self, text), err, fields(comment_id = %comment_id))]
    async fn edit_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        comment_id: &uuid::Uuid,
        text: &str,
    ) -> Result<CrmComment, CrmError> {
        // Update only when the comment's thread resolves to a company or
        // contact owned by the team, so cross-team edits 404.
        let row = sqlx::query!(
            r#"
            UPDATE crm_comment c
            SET text = $3, updated_at = now()
            FROM crm_thread t
            WHERE c.id = $1
              AND c.thread_id = t.id
              AND c.deleted_at IS NULL
              AND (
                EXISTS (
                    SELECT 1 FROM crm_companies co
                    WHERE co.id = t.company_id AND co.team_id = $2
                )
                OR EXISTS (
                    SELECT 1 FROM crm_contacts ct
                    JOIN crm_companies co2 ON co2.id = ct.company_id
                    WHERE ct.id = t.contact_id AND co2.team_id = $2
                )
              )
            RETURNING c.id, c.thread_id, c."order", c.owner, c.sender, c.text,
                      c.metadata, c.created_at, c.updated_at, c.deleted_at
            "#,
            comment_id,
            team_id,
            text,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        match row {
            Some(row) => Ok(CrmComment {
                comment_id: row.id,
                thread_id: row.thread_id,
                order: row.order,
                owner: row.owner,
                sender: row.sender,
                text: row.text,
                metadata: row.metadata,
                created_at: row.created_at,
                updated_at: row.updated_at,
                deleted_at: row.deleted_at,
            }),
            None => Err(CrmError::CommentNotFound),
        }
    }

    #[tracing::instrument(skip(self), err, fields(comment_id = %comment_id))]
    async fn delete_crm_comment(
        &self,
        team_id: &uuid::Uuid,
        comment_id: &uuid::Uuid,
    ) -> Result<DeleteCrmCommentResult, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Resolve the thread and authorize in one shot; absent / cross-team
        // comments are reported as not found.
        let thread_id = sqlx::query_scalar!(
            r#"
            SELECT t.id
            FROM crm_comment c
            JOIN crm_thread t ON t.id = c.thread_id
            WHERE c.id = $1
              AND c.deleted_at IS NULL
              AND (
                EXISTS (
                    SELECT 1 FROM crm_companies co
                    WHERE co.id = t.company_id AND co.team_id = $2
                )
                OR EXISTS (
                    SELECT 1 FROM crm_contacts ct
                    JOIN crm_companies co2 ON co2.id = ct.company_id
                    WHERE ct.id = t.contact_id AND co2.team_id = $2
                )
              )
            "#,
            comment_id,
            team_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        let Some(thread_id) = thread_id else {
            return Err(CrmError::CommentNotFound);
        };

        sqlx::query!(
            r#"UPDATE crm_comment SET deleted_at = now(), updated_at = now() WHERE id = $1"#,
            comment_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // If that was the thread's last live comment, soft-delete the now-empty thread.
        let has_remaining = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM crm_comment
                WHERE thread_id = $1 AND deleted_at IS NULL
            ) AS "exists!"
            "#,
            thread_id,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        let thread_deleted = !has_remaining;
        if thread_deleted {
            sqlx::query!(
                r#"UPDATE crm_thread SET deleted_at = now(), updated_at = now() WHERE id = $1"#,
                thread_id,
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        }

        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(DeleteCrmCommentResult {
            comment_id: *comment_id,
            thread_id,
            thread_deleted,
        })
    }
}

/// Maps a CRM entity type to the team-scoped not-found error used when the
/// entity isn't owned by the requesting team.
fn entity_not_found_err(entity_type: CrmCommentEntityType) -> CrmError {
    match entity_type {
        CrmCommentEntityType::CrmCompany => CrmError::CompanyNotFoundForTeam,
        CrmCommentEntityType::CrmContact => CrmError::ContactNotFoundForTeam,
    }
}

/// Returns whether `(entity_type, entity_id)` is owned by `team_id` — for a
/// contact, ownership is resolved through its company. Generic over the
/// executor so callers can check inside or outside a transaction.
async fn entity_owned_by_team<'e, E>(
    executor: E,
    team_id: &uuid::Uuid,
    entity_type: CrmCommentEntityType,
    entity_id: &uuid::Uuid,
) -> Result<bool, CrmError>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let owned = match entity_type {
        CrmCommentEntityType::CrmCompany => {
            sqlx::query_scalar!(
                r#"
            SELECT EXISTS (
                SELECT 1 FROM crm_companies WHERE id = $1 AND team_id = $2
            ) AS "exists!"
            "#,
                entity_id,
                team_id,
            )
            .fetch_one(executor)
            .await
        }
        CrmCommentEntityType::CrmContact => {
            sqlx::query_scalar!(
                r#"
            SELECT EXISTS (
                SELECT 1 FROM crm_contacts c
                JOIN crm_companies co ON co.id = c.company_id
                WHERE c.id = $1 AND co.team_id = $2
            ) AS "exists!"
            "#,
                entity_id,
                team_id,
            )
            .fetch_one(executor)
            .await
        }
    }
    .map_err(|e| CrmError::StorageLayerError(e.into()))?;
    Ok(owned)
}

/// Fetches all non-deleted comments for the given threads, oldest-first,
/// for grouping under their threads by the caller.
async fn fetch_comments_for_threads(
    pool: &PgPool,
    thread_ids: &[Uuid],
) -> Result<Vec<CrmComment>, CrmError> {
    if thread_ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows = sqlx::query!(
        r#"
        SELECT id, thread_id, "order", owner, sender, text, metadata,
               created_at, updated_at, deleted_at
        FROM crm_comment
        WHERE thread_id = ANY($1) AND deleted_at IS NULL
        ORDER BY created_at ASC, id ASC
        "#,
        thread_ids,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| CrmError::StorageLayerError(e.into()))?;

    Ok(rows
        .into_iter()
        .map(|row| CrmComment {
            comment_id: row.id,
            thread_id: row.thread_id,
            order: row.order,
            owner: row.owner,
            sender: row.sender,
            text: row.text,
            metadata: row.metadata,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
        })
        .collect())
}
