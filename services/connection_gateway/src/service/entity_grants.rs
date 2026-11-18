//! Which entities a websocket connection may receive realtime events for.
//!
//! A connection subscribes to an entity by tracking it (`track_entity`) or by
//! asking for its stream events (`stream_events`). Services that send to an
//! entity, or read its trackers to pick recipients, deliver to every
//! subscriber, so a connection may only subscribe to entities its user can
//! view, and loses the subscription when that access goes away.

use std::collections::{HashMap, HashSet};

use entity_access::domain::{
    models::{AccessError, AnyEntityPermission},
    ports::{AccessRepository, EntityAccessService},
    service::EntityAccessServiceImpl,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use tokio::task::AbortHandle;

use crate::model::tracking::TrackAction;

#[cfg(test)]
mod test;

/// Answers whether a user can view an entity.
pub trait EntityViewAccess: Send + Sync {
    /// `Ok(false)` when the user cannot view the entity, including when it
    /// does not exist or its type has no access check; `Err` only when access
    /// could not be determined.
    fn can_view(
        &self,
        user_id: &MacroUserIdStr<'_>,
        organization_id: Option<i64>,
        entity: &Entity<'_>,
    ) -> impl Future<Output = Result<bool, AccessError>> + Send;
}

impl<R: AccessRepository> EntityViewAccess for EntityAccessServiceImpl<R> {
    // Any permission at all: the lowest access level is view, and channels and
    // teams answer with a role rather than an access level.
    async fn can_view(
        &self,
        user_id: &MacroUserIdStr<'_>,
        organization_id: Option<i64>,
        entity: &Entity<'_>,
    ) -> Result<bool, AccessError> {
        viewable(
            self.generate_entity_access_receipt::<AnyEntityPermission>(
                &user_id.0,
                organization_id,
                &entity.entity_id,
                entity.entity_type,
            )
            .await,
        )
    }
}

/// Reads an access check's result as a yes/no, keeping only the errors that
/// mean the answer is unknown.
fn viewable<T>(result: Result<T, AccessError>) -> Result<bool, AccessError> {
    match result {
        Ok(_) => Ok(true),
        Err(
            AccessError::Unauthorized
            | AccessError::UnauthorizedWithMessage(_)
            | AccessError::NotFound(_)
            | AccessError::BadRequest(_),
        ) => Ok(false),
        Err(error @ (AccessError::Unavailable(_) | AccessError::Internal(_))) => Err(error),
    }
}

/// What to do with a `track_entity` frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    /// Handle the frame as sent.
    Admitted,
    /// Drop the frame.
    Refused,
    /// Drop the frame and tear down the connection's existing subscription:
    /// it was granted earlier, and the user can no longer view the entity.
    Revoked,
}

type GrantKey = (EntityType, String);

fn key(entity: &Entity<'_>) -> GrantKey {
    (entity.entity_type, entity.entity_id.to_string())
}

/// The entities one connection is subscribed to, for the connection's user.
pub struct EntityGrants {
    user_id: MacroUserIdStr<'static>,
    organization_id: Option<i64>,
    /// Entities tracked with `track_entity`.
    granted: HashSet<GrantKey>,
    /// Listeners started by `stream_events`, stopped when access is lost.
    stream_listeners: HashMap<GrantKey, AbortHandle>,
}

impl EntityGrants {
    pub fn new(user_id: MacroUserIdStr<'static>, organization_id: Option<i64>) -> Self {
        Self {
            user_id,
            organization_id,
            granted: HashSet::new(),
            stream_listeners: HashMap::new(),
        }
    }

    /// Decides a `track_entity` frame and records the grant it creates or
    /// ends. An `Err` means access could not be checked; drop the frame.
    pub async fn admit(
        &mut self,
        access: &impl EntityViewAccess,
        entity: &Entity<'_>,
        action: TrackAction,
    ) -> Result<Admission, AccessError> {
        let key = key(entity);
        match action {
            // A close removes only this connection's row, but it also records
            // frecency and announces presence, so it needs a prior grant.
            TrackAction::Close => Ok(if self.granted.remove(&key) {
                Admission::Admitted
            } else {
                Admission::Refused
            }),
            // An open already checked this entity; its pings stay cheap.
            TrackAction::Ping if self.granted.contains(&key) => Ok(Admission::Admitted),
            // A ping with no grant re-creates the row, the same as an open.
            TrackAction::Open | TrackAction::Ping => {
                if self.can_view(access, entity).await? {
                    self.granted.insert(key);
                    Ok(Admission::Admitted)
                } else if self.granted.remove(&key) {
                    Ok(Admission::Revoked)
                } else {
                    Ok(Admission::Refused)
                }
            }
        }
    }

    /// Whether the user may receive `entity`'s stream events.
    pub async fn permits(
        &self,
        access: &impl EntityViewAccess,
        entity: &Entity<'_>,
    ) -> Result<bool, AccessError> {
        self.can_view(access, entity).await
    }

    /// Keeps the listener a permitted `stream_events` frame started, so it
    /// can be stopped when access is lost, replacing any earlier one.
    pub fn hold_stream_listener(&mut self, entity: &Entity<'_>, listener: AbortHandle) {
        if let Some(replaced) = self.stream_listeners.insert(key(entity), listener) {
            replaced.abort();
        }
    }

    /// Re-checks every grant and drops the ones the user can no longer view:
    /// stops their stream listeners, and returns the tracked ones so their
    /// subscriptions can be torn down. A grant whose check fails is kept until
    /// the next pass. Checks run one at a time to keep a connection's share of
    /// the database pool small.
    pub async fn revalidate(&mut self, access: &impl EntityViewAccess) -> Vec<Entity<'static>> {
        let held: HashSet<GrantKey> = self
            .granted
            .iter()
            .chain(self.stream_listeners.keys())
            .cloned()
            .collect();
        let mut revoked = Vec::new();
        for (entity_type, entity_id) in held {
            let entity = entity_type.with_entity_string(entity_id);
            let result = self.can_view(access, &entity).await;
            match result {
                Ok(true) => {}
                Ok(false) => {
                    let key = key(&entity);
                    if let Some(listener) = self.stream_listeners.remove(&key) {
                        listener.abort();
                    }
                    if self.granted.remove(&key) {
                        revoked.push(entity);
                    }
                }
                Err(error) => tracing::warn!(
                    error = ?error,
                    entity_type = %entity.entity_type,
                    entity_id = %entity.entity_id,
                    "could not recheck an entity subscription; keeping it until the next pass"
                ),
            }
        }
        revoked
    }

    #[tracing::instrument(
        name = "connection_gateway.authorize_subscription",
        skip(self, access),
        fields(
            entity_type = %entity.entity_type,
            entity_id = %entity.entity_id,
            allowed = tracing::field::Empty,
        ),
        err
    )]
    async fn can_view(
        &self,
        access: &impl EntityViewAccess,
        entity: &Entity<'_>,
    ) -> Result<bool, AccessError> {
        let allowed = match entity.entity_type {
            // A user entity carries everything sent to that user, so only the
            // user themselves may subscribe to it.
            EntityType::User => MacroUserIdStr::parse_from_str(&entity.entity_id)
                .is_ok_and(|requested| requested.0.as_ref() == self.user_id.0.as_ref()),
            _ => {
                access
                    .can_view(&self.user_id, self.organization_id, entity)
                    .await?
            }
        };
        tracing::Span::current().record("allowed", allowed);
        Ok(allowed)
    }
}

impl Drop for EntityGrants {
    /// The connection is gone; its stream listeners have no one to serve.
    fn drop(&mut self) {
        for listener in self.stream_listeners.values() {
            listener.abort();
        }
    }
}
