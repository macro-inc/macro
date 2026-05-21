//! Implementation of [`CompaniesRepository`] backed by MacroDB.

#[cfg(test)]
mod test;

use crate::domain::{
    companies_repo::CompaniesRepository,
    model::{CrmCompany, CrmDomain, CrmError},
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
            SELECT c.id, c.team_id, c.name, c.email_sync, c.created_at
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
            name: company.name,
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
                    INSERT INTO crm_companies (team_id, name)
                    VALUES ($1, 'TODO')
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

        // Upsert the contact. `ON CONFLICT DO UPDATE SET email = EXCLUDED.email`
        // is a no-op write that exists only to force RETURNING to fire on the
        // conflict path, so we get the existing row's id without a second
        // round trip.
        let contact_id = sqlx::query_scalar!(
            r#"
            INSERT INTO crm_contacts (company_id, email)
            VALUES ($1, $2)
            ON CONFLICT (company_id, email) DO UPDATE SET email = EXCLUDED.email
            RETURNING id
            "#,
            company_id,
            normalized_email,
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
