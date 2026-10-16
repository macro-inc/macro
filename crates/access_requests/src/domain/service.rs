//! Access request policy. No request may directly manufacture an ownership grant.
use super::{models::*, ports::*};
use chrono::Duration;
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use model_owner::Owner;
use models_permissions::{
    share_permission::access_level::AccessLevel,
    sharing::{SharingFacts, SharingTeamRole},
};
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

const PAGE_SIZE: u32 = 50;
const REQUEST_COOLDOWN_SECONDS: i64 = 60;
const DENIAL_COOLDOWN_HOURS: i64 = 24;

/// Cross-entity request workflow over injected authorization and persistence.
pub struct AccessRequestService<R, A, C = SystemClock> {
    /// Repository also consumed by the durable delivery driver.
    pub repository: Arc<R>,
    access: Arc<A>,
    clock: C,
}

/// Human reviewers come from recorded ownership, never an arbitrary Owner-level grant.
pub fn reviewers(facts: &SharingFacts) -> Vec<MacroUserIdStr<'static>> {
    match &facts.owner {
        Owner::User(user) => vec![user.clone()],
        Owner::Bot(_) => match facts.sponsor.as_ref() {
            Some(Owner::User(user)) => vec![user.clone()],
            Some(Owner::Team(_)) => team_reviewers(facts),
            _ => Vec::new(),
        },
        Owner::Team(_) => team_reviewers(facts),
    }
}
fn team_reviewers(facts: &SharingFacts) -> Vec<MacroUserIdStr<'static>> {
    facts
        .team_members
        .iter()
        .filter(|(_, role)| matches!(role, SharingTeamRole::Admin | SharingTeamRole::Owner))
        .map(|(user, _)| user.clone())
        .collect()
}

/// Existing Share capabilities, including View for callers without access.
/// Editor feature flags may further restrict these choices at the frontend boundary.
pub fn supported_levels(kind: ShareEntityType, file_type: Option<&str>) -> Vec<AccessLevel> {
    use AccessLevel::{Comment, Edit, View};
    match kind {
        ShareEntityType::EmailThread => vec![View],
        ShareEntityType::Document => match file_type {
            Some("md" | "docx" | "spreadsheet" | "pptx") => vec![View, Comment, Edit],
            _ => vec![View, Comment],
        },
        ShareEntityType::Chat | ShareEntityType::Call => vec![View, Comment],
        ShareEntityType::Project
        | ShareEntityType::Initiative
        | ShareEntityType::Database
        | ShareEntityType::AgentSession => vec![View, Comment, Edit],
    }
}

impl<R: RequestRepository, A: EntityAccessService, C: Clock> AccessRequestService<R, A, C> {
    /// Compose the workflow without constructing any infrastructure in domain code.
    pub fn new(repository: Arc<R>, access: Arc<A>, clock: C) -> Self {
        Self {
            repository,
            access,
            clock,
        }
    }

    async fn begin(
        &self,
        user: &MacroUserIdStr<'static>,
        entity: ShareEntity,
    ) -> Result<R::Transaction, RequestError> {
        // Do not hold a transaction connection while the access service needs
        // another connection from the same pool.
        let access = self
            .access
            .generate_entity_access_receipt::<ViewAccessLevel>(
                user,
                None,
                &entity.entity_id.to_string(),
                entity.entity_type.into(),
            )
            .await;
        let tx = self.repository.begin(entity).await?;
        // Recorded owners and bot sponsors can review without a separate user grant.
        if !reviewers(tx.facts()).contains(user) && access.is_err() {
            return Err(RequestError::Forbidden);
        }
        Ok(tx)
    }
    async fn level(
        &self,
        user: &MacroUserIdStr<'static>,
        entity: ShareEntity,
    ) -> Result<Option<AccessLevel>, RequestError> {
        self.access
            .get_access_level(
                Some(user),
                &entity.entity_id.to_string(),
                entity.entity_type.into(),
            )
            .await
            .map_err(|error| RequestError::Internal(rootcause::report!(error).into()))
    }

    // Requesting access authenticates the actor without requiring the permission
    // they are asking for. The repository still checks that the entity is live.
    async fn begin_request(
        &self,
        user: &MacroUserIdStr<'static>,
        entity: ShareEntity,
    ) -> Result<(R::Transaction, Option<AccessLevel>), RequestError> {
        let level = self.level(user, entity).await?;
        let tx = self.repository.begin(entity).await?;
        Ok((tx, level))
    }
    fn require_reviewer(
        &self,
        facts: &SharingFacts,
        user: &MacroUserIdStr<'static>,
    ) -> Result<(), RequestError> {
        if reviewers(facts).contains(user) {
            Ok(())
        } else {
            Err(RequestError::Forbidden)
        }
    }
    fn event(
        &self,
        entity: ShareEntity,
        facts: &SharingFacts,
        actor: &MacroUserIdStr<'static>,
        request: Option<AccessRequest>,
        affected: MacroUserIdStr<'static>,
    ) -> RequestEvent {
        let reviewers = reviewers(facts);
        let mut affected_users = reviewers.clone();
        if !affected_users.contains(&affected) {
            affected_users.push(affected)
        }
        RequestEvent {
            id: Uuid::now_v7(),
            entity,
            entity_name: facts.name.clone(),
            file_type: facts.file_type.clone(),
            request,
            actor: actor.clone(),
            reviewers,
            affected_users,
            superseded: Vec::new(),
            trace_context: Default::default(),
        }
    }

    /// Read current request state; non-reviewers never receive other people's requests.
    #[tracing::instrument(name = "access_requests.state", skip_all, fields(entity_id = %entity.entity_id, entity_type = ?entity.entity_type), err)]
    pub async fn state(
        &self,
        user: MacroUserIdStr<'static>,
        entity: ShareEntity,
        offset: u32,
    ) -> Result<AccessRequestState, RequestError> {
        let (mut tx, access_level) = self.begin_request(&user, entity).await?;
        let reviewers = reviewers(tx.facts());
        let can_review = reviewers.contains(&user);
        let supported_levels = if reviewers.is_empty() {
            Vec::new()
        } else {
            supported_levels(entity.entity_type, tx.facts().file_type.as_deref())
        };
        let owner = (access_level.is_some() || can_review).then(|| tx.facts().owner.principal_id());
        let mine = tx.mine(&user).await?;
        let (requests, pending_count) = if can_review {
            tx.pending(offset, PAGE_SIZE).await?
        } else {
            (Vec::new(), 0)
        };
        let end = u64::from(offset) + requests.len() as u64;
        let next_offset = if end < pending_count as u64 {
            u32::try_from(end).ok()
        } else {
            None
        };
        tx.commit().await?;
        Ok(AccessRequestState {
            owner,
            can_review,
            access_level,
            supported_levels,
            mine,
            requests,
            pending_count,
            next_offset,
        })
    }

    /// Submit or change one pending access request. Identical pending replays are harmless.
    #[tracing::instrument(name = "access_requests.submit", skip_all, fields(entity_id = %entity.entity_id, entity_type = ?entity.entity_type), err)]
    pub async fn submit(
        &self,
        user: MacroUserIdStr<'static>,
        entity: ShareEntity,
        args: RequestAccess,
    ) -> Result<AccessRequest, RequestError> {
        let (mut tx, level) = self.begin_request(&user, entity).await?;
        if reviewers(tx.facts()).is_empty() || reviewers(tx.facts()).contains(&user) {
            return Err(RequestError::Forbidden);
        }
        if !supported_levels(entity.entity_type, tx.facts().file_type.as_deref())
            .contains(&args.requested_level)
            || level.is_some_and(|level| args.requested_level <= level)
        {
            return Err(RequestError::InvalidLevel);
        }
        let previous = tx.mine(&user).await?;
        let now = self.clock.now();
        if let Some(previous) = &previous {
            if previous.status == RequestStatus::Pending
                && previous.requested_level == args.requested_level
            {
                return Ok(previous.clone());
            }
            if let Some(until) = previous.retry_after
                && now < until
            {
                return Err(RequestError::Cooldown(until));
            }
            if args.revision != Some(previous.revision) {
                return Err(RequestError::Conflict);
            }
        } else if args.revision.is_some() {
            return Err(RequestError::Conflict);
        }
        let request = AccessRequest {
            id: previous.as_ref().map_or_else(Uuid::now_v7, |r| r.id),
            requester_id: user.clone(),
            requested_level: args.requested_level,
            status: RequestStatus::Pending,
            revision: next_revision(previous.as_ref())?,
            created_at: previous
                .as_ref()
                .filter(|r| r.status == RequestStatus::Pending)
                .map_or(now, |r| r.created_at),
            updated_at: now,
            resolved_at: None,
            granted_level: None,
            retry_after: Some(now + Duration::seconds(REQUEST_COOLDOWN_SECONDS)),
        };
        tx.save(&request).await?;
        let event = self.event(
            entity,
            tx.facts(),
            &user,
            Some(request.clone()),
            user.clone(),
        );
        tx.enqueue(event).await?;
        tx.commit().await?;
        Ok(request)
    }

    /// Cancel only the caller's current revision.
    #[tracing::instrument(name = "access_requests.cancel", skip_all, fields(entity_id = %entity.entity_id, entity_type = ?entity.entity_type), err)]
    pub async fn cancel(
        &self,
        user: MacroUserIdStr<'static>,
        entity: ShareEntity,
        revision: i32,
    ) -> Result<(), RequestError> {
        let (mut tx, _) = self.begin_request(&user, entity).await?;
        let mut request = tx.mine(&user).await?.ok_or(RequestError::NotFound)?;
        if request.status == RequestStatus::Cancelled {
            return Ok(());
        }
        ensure_pending(&request, revision)?;
        request.status = RequestStatus::Cancelled;
        request.revision = next_revision(Some(&request))?;
        request.updated_at = self.clock.now();
        request.resolved_at = Some(request.updated_at);
        tx.save(&request).await?;
        let event = self.event(entity, tx.facts(), &user, Some(request), user.clone());
        tx.enqueue(event).await?;
        tx.commit().await
    }

    /// Resolve a pending revision and atomically grant access or begin the denial cooldown.
    #[tracing::instrument(name = "access_requests.resolve", skip_all, fields(entity_id = %entity.entity_id, entity_type = ?entity.entity_type), err)]
    pub async fn resolve(
        &self,
        user: MacroUserIdStr<'static>,
        entity: ShareEntity,
        id: Uuid,
        args: ResolveRequest,
    ) -> Result<AccessRequest, RequestError> {
        let mut tx = self.begin(&user, entity).await?;
        self.require_reviewer(tx.facts(), &user)?;
        let mut request = tx.request(id).await?.ok_or(RequestError::NotFound)?;
        ensure_pending(&request, args.revision)?;
        if let Some(level) = args.granted_level {
            if !supported_levels(entity.entity_type, tx.facts().file_type.as_deref())
                .contains(&level)
            {
                return Err(RequestError::InvalidLevel);
            }
            tx.grant(&request.requester_id, Some(level), true).await?;
            request.status = RequestStatus::Granted;
            request.granted_level = Some(level);
            request.retry_after = None;
        } else {
            request.status = RequestStatus::Denied;
            request.retry_after = Some(self.clock.now() + Duration::hours(DENIAL_COOLDOWN_HOURS));
        }
        request.revision = next_revision(Some(&request))?;
        request.updated_at = self.clock.now();
        request.resolved_at = Some(request.updated_at);
        tx.save(&request).await?;
        let event = self.event(
            entity,
            tx.facts(),
            &user,
            Some(request.clone()),
            request.requester_id.clone(),
        );
        tx.enqueue(event).await?;
        tx.commit().await?;
        Ok(request)
    }

    /// Direct grants are visible to reviewers and their recipient only.
    #[tracing::instrument(name = "access_requests.direct_access", skip_all, fields(entity_id = %entity.entity_id, entity_type = ?entity.entity_type), err)]
    pub async fn direct_access(
        &self,
        user: MacroUserIdStr<'static>,
        entity: ShareEntity,
    ) -> Result<Vec<DirectAccess>, RequestError> {
        let mut tx = self.begin(&user, entity).await?;
        let can_review = reviewers(tx.facts()).contains(&user);
        let mut grants = tx.direct_access().await?;
        if !can_review {
            grants.retain(|grant| grant.user_id == user.as_ref());
        }
        tx.commit().await?;
        Ok(grants)
    }

    /// Explicit owner management can reduce a direct grant, preserving other access paths.
    #[tracing::instrument(name = "access_requests.set_direct_access", skip_all, fields(entity_id = %entity.entity_id, entity_type = ?entity.entity_type), err)]
    pub async fn set_direct_access(
        &self,
        user: MacroUserIdStr<'static>,
        entity: ShareEntity,
        recipient: MacroUserIdStr<'static>,
        level: Option<AccessLevel>,
    ) -> Result<(), RequestError> {
        let mut tx = self.begin(&user, entity).await?;
        self.require_reviewer(tx.facts(), &user)?;
        if reviewers(tx.facts()).contains(&recipient) {
            return Err(RequestError::Forbidden);
        }
        if let Some(level) = level
            && !supported_levels(entity.entity_type, tx.facts().file_type.as_deref())
                .contains(&level)
        {
            return Err(RequestError::InvalidLevel);
        }
        tx.grant(&recipient, level, false).await?;
        let event = self.event(entity, tx.facts(), &user, None, recipient);
        tx.enqueue(event).await?;
        tx.commit().await
    }
}

fn ensure_pending(request: &AccessRequest, revision: i32) -> Result<(), RequestError> {
    if request.status != RequestStatus::Pending || request.revision != revision {
        Err(RequestError::Conflict)
    } else {
        Ok(())
    }
}
fn next_revision(previous: Option<&AccessRequest>) -> Result<i32, RequestError> {
    previous.map_or(Ok(1), |r| {
        r.revision.checked_add(1).ok_or(RequestError::Conflict)
    })
}
