//! History access extractor.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts, Path},
    http::request::Parts,
};

use super::{ExtractorError, RequiredAccessLevel};
use crate::domain::{
    models::{AccessLevel, EntityType},
    ports::EntityAccessService,
};
use model_user::axum_extractor::MacroUserExtractor;

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
#[derive(Clone, Debug)]
pub struct HistoryAccessExtractor<T, Svc> {
    /// The actual access level the user has.
    pub access_level: AccessLevel,
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

        let MacroUserExtractor { macro_user_id, .. } = parts
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

        // Check access via service
        let required_level = T::required_level();
        let access_level = service
            .check_access(&macro_user_id, &item_id, entity_type, required_level)
            .await
            .map_err(ExtractorError::from)?;

        Ok(Self {
            access_level,
            _marker: PhantomData,
        })
    }
}
