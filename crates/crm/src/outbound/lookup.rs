//! Postgres implementation of the message store's [`CrmParentReader`].

use std::{future::Future, pin::Pin};

use messages::domain::{
    models::MessageParent,
    ports::{CrmParentFacts, CrmParentReader},
};
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// PostgreSQL-backed [`CrmParentReader`].
#[derive(Clone)]
pub struct PgCrmParentReader {
    pool: PgPool,
}

impl PgCrmParentReader {
    /// Create a reader over the shared MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn company(&self, id: Uuid) -> Result<Option<CrmParentFacts>, sqlx::Error> {
        sqlx::query!(
            r#"
            SELECT c.team_id, c.id AS company_id,
                   COALESCE(c.custom_name, dd.name, primary_domain.domain) AS name
            FROM crm_companies c
            LEFT JOIN LATERAL (
                SELECT d.domain FROM crm_domains d
                WHERE d.company_id = c.id
                ORDER BY d.created_at ASC
                LIMIT 1
            ) primary_domain ON TRUE
            LEFT JOIN LATERAL (
                SELECT dd.name FROM crm_domain_directory dd
                WHERE LOWER(dd.domain) = LOWER(primary_domain.domain)
                LIMIT 1
            ) dd ON TRUE
            WHERE c.id = $1
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await
        .map(|row| {
            row.map(|row| CrmParentFacts {
                team_id: row.team_id,
                company_id: row.company_id,
                name: row.name.unwrap_or_default(),
            })
        })
    }

    async fn contact(&self, id: Uuid) -> Result<Option<CrmParentFacts>, sqlx::Error> {
        sqlx::query!(
            r#"
            SELECT c.team_id, ct.company_id, COALESCE(NULLIF(ct.name, ''), ct.email) AS "name!"
            FROM crm_contacts ct
            JOIN crm_companies c ON c.id = ct.company_id
            WHERE ct.id = $1
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await
        .map(|row| {
            row.map(|row| CrmParentFacts {
                team_id: row.team_id,
                company_id: row.company_id,
                name: row.name,
            })
        })
    }
}

impl CrmParentReader for PgCrmParentReader {
    fn read_crm_parent(
        &self,
        parent: &MessageParent,
    ) -> Pin<Box<dyn Future<Output = Result<Option<CrmParentFacts>, rootcause::Report>> + Send + '_>>
    {
        let parent = parent.clone();
        Box::pin(async move {
            let facts = match parent {
                MessageParent::CrmCompany(id) => self.company(id).await?,
                MessageParent::CrmContact(id) => self.contact(id).await?,
                MessageParent::Channel(_) | MessageParent::Document(_) => None,
            };
            Ok(facts)
        })
    }
}
