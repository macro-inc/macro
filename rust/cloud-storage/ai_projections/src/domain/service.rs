//! Domain service for AI projection materialization.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;

use super::models::{
    AiProjectionGenerationRequested, MaterializeProjectionRequest, MaterializeProjectionResponse,
    ProjectionError, ProjectionInstance, ProjectionStatus, Result, ScheduleGenerationReason,
    ScheduleProjectionRequest, Target, UpsertProjectionInstanceRequest,
};
use super::ports::{AiProjectionGenerationPublisher, AiProjectionRepository, AiProjectionService};

/// Default implementation of the AI projection service port.
pub struct AiProjectionServiceImpl<R, P> {
    repository: R,
    publisher: P,
}

impl<R, P> AiProjectionServiceImpl<R, P> {
    /// Create a service from its repository and generation publisher ports.
    pub fn new(repository: R, publisher: P) -> Self {
        Self {
            repository,
            publisher,
        }
    }
}

impl<R, P> AiProjectionServiceImpl<R, P>
where
    R: AiProjectionRepository,
    P: AiProjectionGenerationPublisher,
{
    /// Materialize a projection with an explicit clock value.
    pub async fn materialize_at(
        &self,
        requester: MacroUserIdStr<'static>,
        request: MaterializeProjectionRequest,
        now: DateTime<Utc>,
    ) -> Result<MaterializeProjectionResponse> {
        validate_materialize_request(&request)?;
        self.validate_target_access(&requester, &request.target)
            .await?;

        let upsert_request = UpsertProjectionInstanceRequest::from_materialize_request(
            &request,
            requester.clone(),
            now,
        );
        let instance = self
            .repository
            .get_or_create_instance(upsert_request)
            .await
            .map_err(repository_error)?;

        let schedule_reason = schedule_reason_for_instance(&instance, request.force_refresh, now);
        if let Some(reason) = schedule_reason {
            let event = AiProjectionGenerationRequested {
                cache_key: instance.cache_key.clone(),
                reason,
                requested_by: requester.clone(),
                generation_user_id: instance.generation_user_id.clone(),
                enqueued_at: now,
            };
            self.publisher
                .publish_generation_requested(event)
                .await
                .map_err(publisher_error)?;

            self.repository
                .schedule_generation(ScheduleProjectionRequest {
                    cache_key: instance.cache_key.clone(),
                    requested_by: requester,
                    reason,
                    scheduled_at: now,
                })
                .await
                .map_err(repository_error)?;
        }

        Ok(response_for_instance(
            &instance,
            schedule_reason.is_some(),
            now,
        ))
    }

    async fn validate_target_access(
        &self,
        requester: &MacroUserIdStr<'static>,
        target: &Target,
    ) -> Result<()> {
        match target {
            Target::User { id } if id == requester.as_ref() => Ok(()),
            Target::User { id } => Err(ProjectionError::UserTargetMismatch {
                requester_user_id: requester.to_string(),
                target_user_id: id.clone(),
            }),
            Target::Team { id } => {
                let can_access = self
                    .repository
                    .user_can_access_team(requester.clone(), id.clone())
                    .await
                    .map_err(repository_error)?;

                if can_access {
                    Ok(())
                } else {
                    Err(ProjectionError::UnauthorizedTeamTarget {
                        user_id: requester.to_string(),
                        team_id: id.clone(),
                    })
                }
            }
        }
    }
}

impl<R, P> AiProjectionService for AiProjectionServiceImpl<R, P>
where
    R: AiProjectionRepository,
    P: AiProjectionGenerationPublisher,
{
    fn materialize(
        &self,
        requester: MacroUserIdStr<'static>,
        request: MaterializeProjectionRequest,
    ) -> impl Future<Output = Result<MaterializeProjectionResponse>> + Send {
        self.materialize_at(requester, request, Utc::now())
    }
}

fn validate_materialize_request(request: &MaterializeProjectionRequest) -> Result<()> {
    if request.id.trim().is_empty() {
        return Err(ProjectionError::EmptyProjectionId);
    }

    if request.prompt.trim().is_empty() {
        return Err(ProjectionError::EmptyPrompt);
    }

    if request.target.id().trim().is_empty() {
        return Err(ProjectionError::EmptyTargetId);
    }

    Ok(())
}

fn schedule_reason_for_instance(
    instance: &ProjectionInstance,
    force_refresh: bool,
    now: DateTime<Utc>,
) -> Option<ScheduleGenerationReason> {
    if force_refresh {
        return Some(ScheduleGenerationReason::ForceRefresh);
    }

    if instance.status == ProjectionStatus::Refreshing {
        return None;
    }

    if !instance.has_output() && instance.status != ProjectionStatus::Error {
        return Some(ScheduleGenerationReason::ColdStart);
    }

    if instance.has_output() && instance.is_stale(now) {
        return Some(ScheduleGenerationReason::Stale);
    }

    None
}

fn response_for_instance(
    instance: &ProjectionInstance,
    scheduled_refresh: bool,
    now: DateTime<Utc>,
) -> MaterializeProjectionResponse {
    let status = if !instance.has_output() {
        if instance.status == ProjectionStatus::Error {
            ProjectionStatus::Error
        } else {
            ProjectionStatus::Cold
        }
    } else if scheduled_refresh || instance.status == ProjectionStatus::Refreshing {
        ProjectionStatus::Refreshing
    } else if instance.status == ProjectionStatus::Error {
        ProjectionStatus::Error
    } else if instance.is_stale(now) {
        ProjectionStatus::Refreshing
    } else {
        ProjectionStatus::Ready
    };

    MaterializeProjectionResponse {
        status,
        data: instance.output.clone(),
        error: instance.error.clone(),
        generated_at: instance.generated_at,
        stale_at: instance.stale_at,
    }
}

fn repository_error<E>(error: E) -> ProjectionError
where
    E: Into<anyhow::Error>,
{
    ProjectionError::Repository(error.into())
}

fn publisher_error<E>(error: E) -> ProjectionError
where
    E: Into<anyhow::Error>,
{
    ProjectionError::Publisher(error.into())
}
