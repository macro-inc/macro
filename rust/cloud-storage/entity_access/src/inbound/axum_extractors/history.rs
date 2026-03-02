//! History access extractor.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};

use super::{ExtractorError, InternalUser, RequiredAccessLevel};
use crate::domain::{
    models::{
        AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    },
    ports::EntityAccessService,
};
use model_user::axum_extractor::OptionalMacroUserExtractor;

/// Path parameters for history routes.
#[derive(serde::Deserialize)]
pub struct HistoryParams {
    /// The ID of the item.
    pub item_id: String,
    /// The type of item (e.g., "document", "chat").
    pub item_type: String,
}

/// Validates the user has access to view the history of a particular item.
///
/// Extracts both item_id and item_type from the path parameters.
#[derive(Debug)]
pub struct HistoryAccessExtractor<T: RequiredAccessLevel, Svc> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc)>,
}

#[async_trait]
impl<T, S, Svc> FromRequestParts<S> for HistoryAccessExtractor<T, Svc>
where
    T: RequiredAccessLevel,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(parts, state))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let OptionalMacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        let Path(HistoryParams { item_id, item_type }) =
            <Path<HistoryParams>>::from_request_parts(parts, state)
                .await
                .map_err(|_| ExtractorError::BadRequest("Missing item_id or item_type in path"))?;

        // Parse the item_type string into EntityType
        let entity_type: EntityType = item_type
            .parse()
            .map_err(|_| ExtractorError::BadRequest("Invalid item_type"))?;

        let internal_user: Option<Extension<InternalUser>> = if macro_user_id.is_none() {
            parts
                .extract()
                .await
                .map_err(|_| ExtractorError::Internal)?
        } else {
            None
        };

        if internal_user.is_some() {
            return Ok(Self {
                entity_access_receipt: EntityAccessReceipt {
                    entity: Entity {
                        entity_id: item_id,
                        entity_type,
                    },
                    auth: EntityAccessAuth::Internal,
                    entity_permission: EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner,
                    },
                    _marker: PhantomData,
                },
                _marker: PhantomData,
            });
        }

        let required_level = T::required_level();
        // Check access based on auth state
        let access_level: AccessLevel = match macro_user_id.as_ref() {
            Some(macro_user_id) => service
                .check_access(Some(macro_user_id), &item_id, entity_type, required_level)
                .await
                .map_err(ExtractorError::from)?,
            None => service
                .check_public_access(&item_id, entity_type, required_level)
                .await
                .map_err(ExtractorError::from)?,
        };

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: item_id,
                    entity_type,
                },
                auth: macro_user_id
                    .map(|m| EntityAccessAuth::Authenticated(m.0))
                    .unwrap_or(EntityAccessAuth::Unauthenticated),
                entity_permission: EntityPermission::AccessLevel { access_level },
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}
