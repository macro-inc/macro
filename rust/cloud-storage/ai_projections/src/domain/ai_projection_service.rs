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
        AiProjection, AiProjectionError, ProjectionStatus, TargetType, UpsertProjectionError,
        UpsertProjectionParams, UserAiProjection,
    },
    projection_generator::{GenerationRequest, ProjectionGenerator},
    projection_notifier::ProjectionNotifier,
};

/// The permission required to read professional (premium) features.
pub const READ_PROFESSIONAL_FEATURES: &str = "read:professional_features";

/// The AiProjectionService defines the high-level operations for ai projections.
pub trait AiProjectionService: Clone + Send + Sync + 'static {
    /// Gets or creates a projection definition and the target's instance of it,
    /// returning that instance. The concrete target id is resolved from the
    /// authenticated user: a `user` target resolves to the user's own id, a
    /// `team` target resolves to the user's (single) team.
    ///
    /// A cold instance (or a `regenerate` request) triggers materialization:
    /// asynchronously via the queue by default, or inline when
    /// `await_generation` is set — in which case the returned instance reflects
    /// the finished generation.
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
/// [`AiProjectionRepository`], an [`AiProjectionQueue`], a
/// [`ProjectionGenerator`], and a [`ProjectionNotifier`].
#[derive(Debug, Clone)]
pub struct AiProjectionServiceImpl<R, Q, G, N>
where
    R: AiProjectionRepository,
    Q: AiProjectionQueue,
    G: ProjectionGenerator,
    N: ProjectionNotifier,
{
    repository: R,
    queue: Q,
    generator: G,
    notifier: N,
}

impl<R, Q, G, N> AiProjectionServiceImpl<R, Q, G, N>
where
    R: AiProjectionRepository,
    Q: AiProjectionQueue,
    G: ProjectionGenerator,
    N: ProjectionNotifier,
{
    /// Creates a new AiProjectionServiceImpl.
    pub fn new(repository: R, queue: Q, generator: G, notifier: N) -> Self {
        Self {
            repository,
            queue,
            generator,
            notifier,
        }
    }

    /// Marks the target instance as loading, runs the prompt through the
    /// generator, and stores the result as ready.
    ///
    /// The caller ([`AiProjectionService::materialize`]) owns the processing
    /// claim and is responsible for releasing it and recording errors.
    async fn generate_and_store(
        &self,
        projection: &AiProjection,
        message: &AiProjectionQueueMessage,
    ) -> Result<(), AiProjectionError> {
        self.repository
            .set_projection_loading(
                &message.ai_projection_id,
                &message.target_id,
                &message.prompt_hash,
            )
            .await?;

        // For `user` targets the target id is the user id. `team` targets store
        // a team id here and are not yet materialized against a specific user.
        let user_id = MacroUserIdStr::try_from(message.target_id.clone())
            .map_err(|e| AiProjectionError::BadRequest(format!("invalid target user id: {e}")))?;

        let result = self
            .generator
            .generate(
                &user_id,
                GenerationRequest {
                    projection_id: &projection.id,
                    prompt: &projection.prompt,
                    model: projection.model.as_deref(),
                    output_schema: projection.output_schema.as_ref(),
                },
            )
            .await?;

        let generated_at = chrono::Utc::now();
        let stale_at = generated_at + projection.expiry.to_duration();

        self.repository
            .set_projection_result(
                &message.ai_projection_id,
                &message.target_id,
                &message.prompt_hash,
                &result,
                generated_at,
                stale_at,
            )
            .await?;

        Ok(())
    }

    /// Pushes the instance's current state to the target's connected clients.
    /// Best-effort: a failed lookup or send is logged and swallowed so
    /// notification issues never fail materialization.
    async fn notify_updated(&self, target_type: TargetType, message: &AiProjectionQueueMessage) {
        let instance = match self
            .repository
            .get_target_projection(&message.ai_projection_id, &message.target_id)
            .await
        {
            Ok(instance) => instance,
            Err(e) => {
                tracing::error!(error=?e, "failed to load ai projection instance for notification");
                return;
            }
        };
        self.notifier
            .notify_updated(target_type, &instance)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "failed to push ai projection update notification");
            })
            .ok();
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

/// Computes the version hash used as part of a projection's cache key: any
/// change to the prompt, model, or output schema regenerates cached instances.
pub fn hash_projection_version(
    prompt: &str,
    model: Option<&str>,
    output_schema: Option<&serde_json::Value>,
) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prompt.as_bytes());
    hasher.update([0u8]);
    hasher.update(model.unwrap_or_default().as_bytes());
    hasher.update([0u8]);
    if let Some(schema) = output_schema {
        // serde_json::Value maps are BTreeMap-backed, so serialization is
        // canonical regardless of the key order the client sent.
        hasher.update(schema.to_string().as_bytes());
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

impl<R, Q, G, N> AiProjectionService for AiProjectionServiceImpl<R, Q, G, N>
where
    R: AiProjectionRepository,
    Q: AiProjectionQueue,
    G: ProjectionGenerator,
    N: ProjectionNotifier,
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

        let prompt_hash = hash_projection_version(
            &params.prompt,
            params.model.as_deref(),
            params.output_schema.as_ref(),
        );

        let projection = self
            .repository
            .upsert_projection_definition(
                &params.id,
                &params.prompt,
                &prompt_hash,
                params.target_type,
                params.refresh_cadence,
                params.expiry,
                params.model.as_deref(),
                params.output_schema.as_ref(),
            )
            .await?;

        // An instance whose prompt_hash no longer matches the definition comes
        // back reset to cold, so a changed prompt/model/schema regenerates.
        let mut target_projection = self
            .repository
            .get_or_create_target_projection(&projection.id, &target_id, &projection.prompt_hash)
            .await?;

        let needs_generation =
            target_projection.status == ProjectionStatus::Cold || params.regenerate;
        if !needs_generation {
            return Ok(target_projection);
        }

        let message = AiProjectionQueueMessage {
            ai_projection_id: target_projection.ai_projection_id.clone(),
            target_id: target_projection.target_id.clone(),
            prompt_hash: target_projection.prompt_hash.clone(),
        };

        if params.await_generation {
            // Materialize inline and return the finished state. Generation
            // failures are recorded on the instance (status `error`) rather
            // than failing the request, and a concurrent claim elsewhere means
            // the state below reflects that in-flight work.
            self.materialize(message)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "inline ai projection materialization failed");
                })
                .ok();
            target_projection = self
                .repository
                .get_target_projection(&projection.id, &target_id)
                .await?;
            return Ok(target_projection);
        }

        // Re-triggering over an existing result: surface as refreshing so the
        // stale result stays visible while the regeneration is in flight.
        if target_projection.status != ProjectionStatus::Cold {
            self.repository
                .set_projection_refreshing(&projection.id, &target_id)
                .await?;
            target_projection.status = ProjectionStatus::Refreshing;
        }

        // The instance already exists, so a failed enqueue is logged and
        // swallowed rather than failing the request.
        self.queue
            .enqueue_materialization(message)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "failed to enqueue ai projection materialization");
            })
            .ok();

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

        let projection = self
            .repository
            .get_projection(&message.ai_projection_id)
            .await?;

        // The definition was revised after this message was enqueued; a newer
        // message for the current version exists, so skip and acknowledge.
        if projection.prompt_hash != message.prompt_hash {
            tracing::info!(
                ai_projection_id = %message.ai_projection_id,
                target_id = %message.target_id,
                "ai projection version changed since enqueue; skipping stale message"
            );
            return Ok(());
        }

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
        let result = self.generate_and_store(&projection, &message).await;

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
                self.notify_updated(projection.target_type, &message).await;
                Ok(())
            }
            Err(e) => {
                // Record the failure for visibility, then release the claim so
                // SQS redelivery can re-acquire and retry.
                self.repository
                    .set_projection_error(
                        &message.ai_projection_id,
                        &message.target_id,
                        &message.prompt_hash,
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
                self.notify_updated(projection.target_type, &message).await;
                Err(e)
            }
        }
    }
}
