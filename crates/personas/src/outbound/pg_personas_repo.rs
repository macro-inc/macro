//! Postgres [`PersonaRepo`].

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::error::{PersonaError, Result};
use crate::domain::models::{BotId, CreatePersonaRequest, PatchPersonaRequest, Persona};
use crate::domain::ports::PersonaRepo;

/// [`PersonaRepo`] over the `personas` table.
#[derive(Debug, Clone)]
pub struct PgPersonasRepo {
    pool: PgPool,
}

impl PgPersonasRepo {
    /// Wrap a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// A `personas` row.
struct PersonaRow {
    id: Uuid,
    owner_user_id: String,
    name: String,
    handle: String,
    description: Option<String>,
    avatar_url: Option<String>,
    system_prompt: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<PersonaRow> for Persona {
    fn from(row: PersonaRow) -> Self {
        Self {
            id: BotId::new_from_uuid(row.id),
            owner_user_id: row.owner_user_id,
            name: row.name,
            handle: row.handle,
            description: row.description,
            avatar_url: row.avatar_url,
            system_prompt: row.system_prompt,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

/// Map an insert/update failure, turning a handle uniqueness violation into
/// the typed error the domain reports to the user.
fn map_write_error(error: sqlx::Error) -> PersonaError {
    if let sqlx::Error::Database(db_error) = &error
        && db_error.constraint() == Some("personas_owner_handle_unique")
    {
        return PersonaError::HandleTaken;
    }
    PersonaError::Repo(rootcause::report!(error).into())
}

impl PersonaRepo for PgPersonasRepo {
    async fn create_persona(
        &self,
        id: BotId,
        owner: MacroUserIdStr<'static>,
        req: CreatePersonaRequest,
    ) -> Result<Persona> {
        let row = sqlx::query_as!(
            PersonaRow,
            r#"
            INSERT INTO personas
                (id, owner_user_id, name, handle, description, avatar_url, system_prompt)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING
                id,
                owner_user_id,
                name,
                handle,
                description,
                avatar_url,
                system_prompt,
                created_at,
                updated_at
            "#,
            id.as_uuid(),
            owner.as_ref(),
            req.name,
            req.handle,
            req.description,
            req.avatar_url,
            req.system_prompt,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(map_write_error)?;
        Ok(row.into())
    }

    async fn list_personas(&self, owner: MacroUserIdStr<'static>) -> Result<Vec<Persona>> {
        let rows = sqlx::query_as!(
            PersonaRow,
            r#"
            SELECT
                id,
                owner_user_id,
                name,
                handle,
                description,
                avatar_url,
                system_prompt,
                created_at,
                updated_at
            FROM personas
            WHERE owner_user_id = $1
              AND deleted_at IS NULL
            ORDER BY created_at DESC
            "#,
            owner.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| PersonaError::Repo(rootcause::report!(error).into()))?;
        Ok(rows.into_iter().map(Persona::from).collect())
    }

    async fn get_persona(&self, id: BotId) -> Result<Option<Persona>> {
        let row = sqlx::query_as!(
            PersonaRow,
            r#"
            SELECT
                id,
                owner_user_id,
                name,
                handle,
                description,
                avatar_url,
                system_prompt,
                created_at,
                updated_at
            FROM personas
            WHERE id = $1
              AND deleted_at IS NULL
            "#,
            id.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(|error| PersonaError::Repo(rootcause::report!(error).into()))?;
        Ok(row.map(Persona::from))
    }

    async fn patch_persona(&self, id: BotId, req: PatchPersonaRequest) -> Result<Option<Persona>> {
        // The nullable fields distinguish "leave unchanged" (absent) from
        // "clear" (null), which COALESCE cannot express, so each carries an
        // explicit presence flag.
        let row = sqlx::query_as!(
            PersonaRow,
            r#"
            UPDATE personas
            SET name = COALESCE($2, name),
                handle = COALESCE($3, handle),
                description = CASE WHEN $4 THEN $5 ELSE description END,
                avatar_url = CASE WHEN $6 THEN $7 ELSE avatar_url END,
                system_prompt = CASE WHEN $8 THEN $9 ELSE system_prompt END,
                updated_at = now()
            WHERE id = $1
              AND deleted_at IS NULL
            RETURNING
                id,
                owner_user_id,
                name,
                handle,
                description,
                avatar_url,
                system_prompt,
                created_at,
                updated_at
            "#,
            id.as_uuid(),
            req.name,
            req.handle,
            req.description.is_some(),
            req.description.flatten(),
            req.avatar_url.is_some(),
            req.avatar_url.flatten(),
            req.system_prompt.is_some(),
            req.system_prompt.flatten(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(map_write_error)?;
        Ok(row.map(Persona::from))
    }

    async fn delete_persona(&self, id: BotId) -> Result<bool> {
        let result = sqlx::query!(
            r#"
            UPDATE personas
            SET deleted_at = now(),
                updated_at = now()
            WHERE id = $1
              AND deleted_at IS NULL
            "#,
            id.as_uuid(),
        )
        .execute(&self.pool)
        .await
        .map_err(|error| PersonaError::Repo(rootcause::report!(error).into()))?;
        Ok(result.rows_affected() > 0)
    }
}
