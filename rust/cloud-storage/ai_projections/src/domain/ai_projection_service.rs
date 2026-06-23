//! Service layer (inbound port) for ai projections.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use models_ai_projection::AiProjectionQueueMessage;
use sha2::{Digest, Sha256};

use crate::domain::{
    ai_projection_queue::AiProjectionQueue,
    ai_projection_repo::AiProjectionRepository,
    model::{
        AiProjectionError, ProjectionStatus, TargetType, UpsertProjectionError,
        UpsertProjectionParams, UserAiProjection,
    },
    projection_generator::ProjectionGenerator,
};

/// The permission required to read professional (premium) features.
pub const READ_PROFESSIONAL_FEATURES: &str = "read:professional_features";

/// The AiProjectionService defines the high-level operations for ai projections.
pub trait AiProjectionService: Clone + Send + Sync + 'static {
    /// Gets or creates a projection definition and the target's cold instance
    /// of it, returning that instance. The concrete target id is resolved from
    /// the authenticated user: a `user` target resolves to the user's own id,
    /// a `team` target resolves to the user's (single) team.
    fn upsert_projection(
        &self,
        user_id: &MacroUserIdStr<'_>,
        params: UpsertProjectionParams,
    ) -> impl Future<Output = Result<UserAiProjection, UpsertProjectionError>> + Send;

    /// Returns whether the user has the `read:professional_features` permission.
    fn has_professional_features(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, AiProjectionError>> + Send;

    /// Materializes the projection instance referenced by the queue message.
    ///
    /// This is invoked by the inbound worker for each dequeued message and is
    /// responsible for (eventually) generating the AI result and persisting it.
    fn materialize(
        &self,
        message: AiProjectionQueueMessage,
    ) -> impl Future<Output = Result<(), AiProjectionError>> + Send;
}

/// Implementation of [`AiProjectionService`] backed by an
/// [`AiProjectionRepository`], an [`AiProjectionQueue`], and a
/// [`ProjectionGenerator`].
#[derive(Debug, Clone)]
pub struct AiProjectionServiceImpl<R, Q, G>
where
    R: AiProjectionRepository,
    Q: AiProjectionQueue,
    G: ProjectionGenerator,
{
    repository: R,
    queue: Q,
    generator: G,
}

impl<R, Q, G> AiProjectionServiceImpl<R, Q, G>
where
    R: AiProjectionRepository,
    Q: AiProjectionQueue,
    G: ProjectionGenerator,
{
    /// Creates a new AiProjectionServiceImpl.
    pub fn new(repository: R, queue: Q, generator: G) -> Self {
        Self {
            repository,
            queue,
            generator,
        }
    }

    /// Loads the projection definition, marks the target instance as loading,
    /// runs the prompt through the generator, and stores the result as ready.
    ///
    /// The caller ([`AiProjectionService::materialize`]) owns the processing
    /// claim and is responsible for releasing it and recording errors.
    async fn generate_and_store(
        &self,
        message: &AiProjectionQueueMessage,
    ) -> Result<(), AiProjectionError> {
        let projection = self
            .repository
            .get_projection(&message.ai_projection_id)
            .await?;

        self.repository
            .set_projection_loading(&message.ai_projection_id, &message.target_id)
            .await?;

        // For `user` targets the target id is the user id. `team` targets store
        // a team id here and are not yet materialized against a specific user.
        let user_id = MacroUserIdStr::try_from(message.target_id.clone())
            .map_err(|e| AiProjectionError::BadRequest(format!("invalid target user id: {e}")))?;

        let result = self
            .generator
            .generate(&user_id, &projection.prompt)
            .await?;

        let generated_at = chrono::Utc::now();
        let stale_at = generated_at + projection.expiry.to_duration();

        self.repository
            .set_projection_result(
                &message.ai_projection_id,
                &message.target_id,
                &result,
                generated_at,
                stale_at,
            )
            .await?;

        Ok(())
    }

    /// Resolves the concrete target id from the authenticated user and the
    /// requested target type. A `user` target resolves to the user's own id; a
    /// `team` target resolves to the user's single team (erroring if the user
    /// is in zero or multiple teams).
    async fn resolve_target_id(
        &self,
        user_id: &MacroUserIdStr<'_>,
        target_type: TargetType,
    ) -> Result<String, UpsertProjectionError> {
        match target_type {
            TargetType::User => Ok(user_id.as_ref().to_string()),
            TargetType::Team => {
                let mut team_ids = self.repository.get_user_team_ids(user_id).await?;
                match team_ids.len() {
                    1 => Ok(team_ids.remove(0).to_string()),
                    0 => Err(UpsertProjectionError::BadRequest(
                        "user is not a member of any team".to_string(),
                    )),
                    _ => Err(UpsertProjectionError::BadRequest(
                        "user belongs to multiple teams; team target is ambiguous".to_string(),
                    )),
                }
            }
        }
    }
}

/// Computes the prompt version hash used as part of a projection's cache key.
pub fn hash_prompt(prompt: &str) -> String {
    let digest = Sha256::digest(prompt.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

impl<R, Q, G> AiProjectionService for AiProjectionServiceImpl<R, Q, G>
where
    R: AiProjectionRepository,
    Q: AiProjectionQueue,
    G: ProjectionGenerator,
{
    #[tracing::instrument(skip(self), err)]
    async fn upsert_projection(
        &self,
        user_id: &MacroUserIdStr<'_>,
        params: UpsertProjectionParams,
    ) -> Result<UserAiProjection, UpsertProjectionError> {
        if params.id.trim().is_empty() {
            return Err(UpsertProjectionError::BadRequest(
                "projection id cannot be empty".to_string(),
            ));
        }
        if params.prompt.trim().is_empty() {
            return Err(UpsertProjectionError::BadRequest(
                "projection prompt cannot be empty".to_string(),
            ));
        }

        let target_id = self.resolve_target_id(user_id, params.target_type).await?;

        let prompt_hash = hash_prompt(&params.prompt);

        let projection = self
            .repository
            .get_or_create_projection(
                &params.id,
                &params.prompt,
                &prompt_hash,
                params.target_type,
                params.refresh_cadence,
                params.expiry,
            )
            .await?;

        let target_projection = self
            .repository
            .get_or_create_target_projection(&projection.id, &target_id, &projection.prompt_hash)
            .await?;

        // A cold instance has no materialized result yet, so request async
        // materialization. The instance already exists, so a failed enqueue is
        // logged and swallowed rather than failing the request.
        if target_projection.status == ProjectionStatus::Cold {
            self.queue
                .enqueue_materialization(AiProjectionQueueMessage {
                    ai_projection_id: target_projection.ai_projection_id.clone(),
                    target_id: target_projection.target_id.clone(),
                    prompt_hash: target_projection.prompt_hash.clone(),
                })
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "failed to enqueue ai projection materialization");
                })
                .ok();
        }

        Ok(target_projection)
    }

    #[tracing::instrument(skip(self), err)]
    async fn has_professional_features(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<bool, AiProjectionError> {
        self.repository
            .user_has_permission(user_id, READ_PROFESSIONAL_FEATURES)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn materialize(
        &self,
        message: AiProjectionQueueMessage,
    ) -> Result<(), AiProjectionError> {
        tracing::info!(
            ai_projection_id = %message.ai_projection_id,
            target_id = %message.target_id,
            prompt_hash = %message.prompt_hash,
            "materializing ai projection"
        );

        // Claim the (ai_projection_id, target_id) pair. If another worker is
        // already processing it, skip and acknowledge the message rather than
        // duplicating work.
        let acquired = self
            .repository
            .try_start_processing(&message.ai_projection_id, &message.target_id)
            .await?;
        if !acquired {
            tracing::info!(
                ai_projection_id = %message.ai_projection_id,
                target_id = %message.target_id,
                "ai projection already processing; skipping"
            );
            return Ok(());
        }

        // Run the generation, then release the claim regardless of the outcome
        // so a retried message can re-acquire it.
        let result = self.generate_and_store(&message).await;

        match result {
            Ok(()) => {
                // Best-effort release; a leftover row would be reclaimed by the
                // staleness check on the next attempt anyway.
                self.repository
                    .finish_processing(&message.ai_projection_id, &message.target_id)
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "failed to release ai projection processing claim");
                    })
                    .ok();
                Ok(())
            }
            Err(e) => {
                // Record the failure for visibility, then release the claim so
                // SQS redelivery can re-acquire and retry.
                self.repository
                    .set_projection_error(
                        &message.ai_projection_id,
                        &message.target_id,
                        &e.to_string(),
                    )
                    .await
                    .inspect_err(|err| {
                        tracing::error!(error=?err, "failed to record ai projection error");
                    })
                    .ok();
                self.repository
                    .finish_processing(&message.ai_projection_id, &message.target_id)
                    .await?;
                Err(e)
            }
        }
    }
}
