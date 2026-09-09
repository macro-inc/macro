//! [`ListStore`] over `crm_lists` and `crm_list_entries` in MacroDB.

use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::{
    lists::{CrmList, CrmListEntry, CrmListParentType, ListStore},
    model::CrmError,
};

/// Postgres-backed [`ListStore`].
#[derive(Debug, Clone)]
pub struct PgListStore {
    pool: PgPool,
}

impl PgListStore {
    /// Wrap a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Postgres unique violation.
const UNIQUE_VIOLATION: &str = "23505";

impl ListStore for PgListStore {
    #[tracing::instrument(skip(self), err)]
    async fn list_lists(&self, team_id: &Uuid) -> Result<Vec<CrmList>, CrmError> {
        let lists = sqlx::query_as!(
            CrmList,
            r#"
            SELECT
                id,
                team_id,
                name,
                parent_type AS "parent_type: CrmListParentType",
                builtin,
                created_at,
                updated_at
            FROM crm_lists
            WHERE team_id = $1
            ORDER BY builtin DESC, name, id
            "#,
            team_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(lists)
    }

    #[tracing::instrument(skip(self), err)]
    async fn create_list(
        &self,
        team_id: &Uuid,
        name: &str,
        parent_type: CrmListParentType,
    ) -> Result<CrmList, CrmError> {
        let result = sqlx::query_as!(
            CrmList,
            r#"
            INSERT INTO crm_lists (team_id, name, parent_type)
            VALUES ($1, $2, $3)
            RETURNING
                id,
                team_id,
                name,
                parent_type AS "parent_type: CrmListParentType",
                builtin,
                created_at,
                updated_at
            "#,
            team_id,
            name,
            parent_type as CrmListParentType,
        )
        .fetch_one(&self.pool)
        .await;
        match result {
            Ok(list) => Ok(list),
            Err(sqlx::Error::Database(db)) if db.code().as_deref() == Some(UNIQUE_VIOLATION) => {
                Err(CrmError::InvalidRequest(
                    "the team already has a list with this name".into(),
                ))
            }
            Err(error) => Err(anyhow::Error::from(error).into()),
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_list(&self, team_id: &Uuid, list_id: &Uuid) -> Result<Option<CrmList>, CrmError> {
        let list = sqlx::query_as!(
            CrmList,
            r#"
            SELECT
                id,
                team_id,
                name,
                parent_type AS "parent_type: CrmListParentType",
                builtin,
                created_at,
                updated_at
            FROM crm_lists
            WHERE id = $1 AND team_id = $2
            "#,
            list_id,
            team_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(list)
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_entries(
        &self,
        list_id: &Uuid,
        include_hidden: bool,
    ) -> Result<Vec<CrmListEntry>, CrmError> {
        let entries = sqlx::query_as!(
            CrmListEntry,
            r#"
            SELECT e.id, e.list_id, e.parent_id, e.created_at, e.updated_at
            FROM crm_list_entries e
            JOIN crm_lists l
                ON l.id = e.list_id
            LEFT JOIN crm_companies c
                ON l.parent_type = 'company' AND c.id = e.parent_id
            LEFT JOIN crm_contacts ct
                ON l.parent_type = 'contact' AND ct.id = e.parent_id
            LEFT JOIN crm_companies cc
                ON cc.id = ct.company_id
            WHERE e.list_id = $1
              AND ($2 OR COALESCE(c.hidden, ct.hidden OR cc.hidden, false) = false)
            ORDER BY e.created_at, e.id
            "#,
            list_id,
            include_hidden,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(entries)
    }

    #[tracing::instrument(skip(self), err)]
    async fn parent_exists(
        &self,
        team_id: &Uuid,
        parent_type: CrmListParentType,
        parent_id: &Uuid,
        include_hidden: bool,
    ) -> Result<bool, CrmError> {
        let exists = sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM crm_companies c
                WHERE $2 = 'company'
                  AND c.id = $3
                  AND c.team_id = $1
                  AND ($4 OR NOT c.hidden)
                UNION ALL
                SELECT 1
                FROM crm_contacts ct
                JOIN crm_companies c ON c.id = ct.company_id
                WHERE $2 = 'contact'
                  AND ct.id = $3
                  AND c.team_id = $1
                  AND ($4 OR NOT (ct.hidden OR c.hidden))
            ) AS "exists!"
            "#,
            team_id,
            parent_type.as_db_str(),
            parent_id,
            include_hidden,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(exists)
    }

    #[tracing::instrument(skip(self), err)]
    async fn create_entry(
        &self,
        list_id: &Uuid,
        parent_id: &Uuid,
    ) -> Result<CrmListEntry, CrmError> {
        let entry = sqlx::query_as!(
            CrmListEntry,
            r#"
            INSERT INTO crm_list_entries (list_id, parent_id)
            VALUES ($1, $2)
            RETURNING id, list_id, parent_id, created_at, updated_at
            "#,
            list_id,
            parent_id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(anyhow::Error::from)?;
        Ok(entry)
    }
}
