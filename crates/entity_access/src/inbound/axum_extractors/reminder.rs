//! Reminder access extractor.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorization, MacroAuthorizationService, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor,
};
use uuid::Uuid;

use super::{ExtractorError, RequiredPermission};
use crate::domain::{
    models::{Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType},
    ports::EntityAccessService,
};

/// Path parameters for reminder routes.
#[derive(serde::Deserialize)]
struct ReminderPathParams {
    /// The id of the reminder.
    id: Uuid,
}

/// Validates that the caller owns the reminder named in the path.
///
/// A reminder is never shared, so the only permission it can carry is
/// [`AccessLevel::Owner`]. Requesting anything less still works — the owner
/// satisfies every requirement — but there is no weaker grant to hand out.
///
/// Bots are deliberately unsupported: a reminder belongs to a person, and a
/// team-scoped bot has no user identity to own one.
#[derive(Debug)]
pub struct ReminderAccessExtractor<T: RequiredPermission, Svc, Auth> {
    /// The entity access receipt.
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc, Auth)>,
}

impl<T, S, Svc, Auth> FromRequestParts<S> for ReminderAccessExtractor<T, Svc, Auth>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    MacroAuthorizationState<Auth>: FromRef<S>,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let authorization =
            OptionalMacroAuthorizationExtractor::<Auth, AnyPrincipal>::from_request_parts(
                parts, state,
            )
            .await
            .map_err(ExtractorError::from)?;

        let Path(ReminderPathParams { id }) =
            <Path<ReminderPathParams>>::from_request_parts(parts, state)
                .await
                .map_err(|_| {
                    ExtractorError::BadRequest("Missing or malformed reminder id in path")
                })?;
        let reminder_id = id.to_string();

        if let Some(MacroAuthorization::Bot(_)) = authorization.authorization.as_ref() {
            return Err(ExtractorError::UnauthorizedWithMessage(
                "bots cannot access reminders",
            ));
        }

        let entity = Entity {
            entity_id: reminder_id.clone(),
            entity_type: EntityType::Reminder,
        };

        // Unlike the other extractors there is no internal-acting-as-nobody
        // bypass: ownership *is* the access model here, so a receipt with no
        // user behind it would name no reminders at all.
        let Some(user_id) = authorization
            .authorization
            .as_ref()
            .and_then(MacroAuthorization::acting_user)
            .map(|user| user.macro_user_id.clone())
        else {
            return Err(ExtractorError::Unauthorized);
        };

        let access_level = service
            .get_access_level(Some(&user_id), &reminder_id, EntityType::Reminder)
            .await
            .map_err(ExtractorError::from)?
            // No row, or somebody else's row. Both are "not yours", and saying
            // which would leak whether the id exists.
            .ok_or(ExtractorError::Unauthorized)?;

        let entity_permission = EntityPermission::AccessLevel { access_level };
        if !entity_permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        }

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity,
                auth: EntityAccessAuth::Authenticated(user_id),
                entity_permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}
