//! PostgreSQL implementation of atomic email-thread share-policy persistence.

use crate::service::thread_share::{ThreadShareError, ThreadShareRepository};
use model_entity::EntityType;
use models_permissions::share_permission::{
    UpdateSharePermissionRequestV2,
    team_share::{AuthorizedTeamShareCommand, TeamShareFacts},
};
use share_permission_db_utils::team_share::{self, TeamShareError as PersistenceError};
use sqlx::PgPool;

#[cfg(test)]
mod test;

/// Thread-sharing adapter using the common guarded canonical persistence protocol.
pub struct PgThreadShareRepository {
    db: PgPool,
}

impl PgThreadShareRepository {
    /// Construct a repository from the application's database pool.
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

fn persistence_error(error: rootcause::Report<PersistenceError>) -> ThreadShareError {
    match error.current_context() {
        PersistenceError::NotFound => ThreadShareError::NotFound,
        PersistenceError::ChangedFacts | PersistenceError::UntrackedGrant => {
            ThreadShareError::Conflict
        }
        PersistenceError::InvalidEntity => ThreadShareError::InvalidInput,
        _ => ThreadShareError::Internal(error.into()),
    }
}

impl ThreadShareRepository for PgThreadShareRepository {
    async fn owner_facts(&self, thread_id: uuid::Uuid) -> Result<TeamShareFacts, ThreadShareError> {
        let mut transaction = self
            .db
            .begin()
            .await
            .map_err(|error| ThreadShareError::Internal(rootcause::report!(error).into()))?;
        let entity = EntityType::EmailThread.with_entity_string(thread_id.to_string());
        let facts = team_share::load_facts(&mut transaction, &entity)
            .await
            .map_err(persistence_error)?;
        transaction
            .commit()
            .await
            .map_err(|error| ThreadShareError::Internal(rootcause::report!(error).into()))?;
        Ok(facts)
    }

    async fn persist(
        &self,
        thread_id: uuid::Uuid,
        mut policy: UpdateSharePermissionRequestV2,
        command: Option<AuthorizedTeamShareCommand>,
    ) -> Result<(), ThreadShareError> {
        // A supplied field can never fall through to the legacy column-only writer.
        if policy.team_share_access_level.is_some() != command.is_some() {
            return Err(ThreadShareError::InvalidInput);
        }
        if let Some(command) = &command
            && (command.expected().entity
                != EntityType::EmailThread.with_entity_string(thread_id.to_string())
                || Some(command.target().map(|grant| grant.level.into()))
                    != policy.team_share_access_level)
        {
            return Err(ThreadShareError::InvalidInput);
        }
        let mut transaction = self
            .db
            .begin()
            .await
            .map_err(|error| ThreadShareError::Internal(rootcause::report!(error).into()))?;
        team_share::acquire_guard(&mut transaction)
            .await
            .map_err(|error| ThreadShareError::Internal(rootcause::report!(error).into()))?;
        if let Some(command) = &command {
            team_share::apply(&mut transaction, command)
                .await
                .map_err(persistence_error)?;
        }
        let permission_id = team_share::ensure_thread_share_permission_in_transaction(
            &mut transaction,
            &thread_id.to_string(),
        )
        .await
        .map_err(persistence_error)?;
        // Canonical sharing was applied above; the legacy helper rejects supplied team fields.
        policy.team_share_access_level = None;
        macro_db_client::share_permission::edit::edit_thread_permission(
            &mut transaction,
            &thread_id,
            &permission_id,
            &policy,
        )
        .await
        .map_err(|error| ThreadShareError::Internal(rootcause::report!(error).into()))?;
        transaction
            .commit()
            .await
            .map_err(|error| ThreadShareError::Internal(rootcause::report!(error).into()))?;
        Ok(())
    }
}
