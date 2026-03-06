//! Document access extractor.

use std::marker::PhantomData;
use std::sync::Arc;

use axum::{
    Extension, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts},
    http::request::Parts,
};

use super::{ExtractorError, RequiredPermission};
use crate::{
    domain::{
        models::{
            AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission,
            EntityType,
        },
        ports::EntityAccessService,
    },
    inbound::axum_extractors::InternalUser,
};
use model::document::DocumentBasic;
use model_user::axum_extractor::OptionalMacroUserExtractor;

/// Validates that the user has at least the required access level to a document.
///
/// Type parameter `T` specifies the required access level (ViewAccessLevel, EditAccessLevel, etc.)
/// Type parameter `Svc` is the entity access service implementation.
///
/// # Prerequisites
///
/// - User must be authenticated (MacroUserExtractor in extensions)
/// - Document context must be loaded (DocumentBasic in extensions)
#[derive(Debug)]
pub struct DocumentAccessExtractor<T: RequiredPermission, Svc> {
    /// The entity access receipt
    pub entity_access_receipt: EntityAccessReceipt<T>,
    _marker: PhantomData<(T, Svc)>,
}

#[async_trait]
impl<T, S, Svc> FromRequestParts<S> for DocumentAccessExtractor<T, Svc>
where
    T: RequiredPermission,
    Arc<Svc>: FromRef<S>,
    Svc: EntityAccessService,
    S: Send + Sync + 'static,
{
    type Rejection = ExtractorError;

    #[tracing::instrument(err, skip(state, parts))]
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let service = <Arc<Svc>>::from_ref(state);

        let OptionalMacroUserExtractor { macro_user_id, .. } = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

        let document_context: Extension<DocumentBasic> = parts
            .extract()
            .await
            .map_err(|_| ExtractorError::Internal)?;

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
                        entity_id: document_context.document_id.clone(),
                        entity_type: EntityType::Document,
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

        // Check ownership only if authenticated
        if let Some(ref user_id) = macro_user_id
            && document_context.owner == *user_id
        {
            return Ok(Self {
                entity_access_receipt: EntityAccessReceipt {
                    entity: Entity {
                        entity_id: document_context.document_id.clone(),
                        entity_type: EntityType::Document,
                    },
                    auth: EntityAccessAuth::Authenticated(user_id.clone().0),
                    entity_permission: EntityPermission::AccessLevel {
                        access_level: AccessLevel::Owner,
                    },
                    _marker: PhantomData,
                },
                _marker: PhantomData,
            });
        }

        // Deleted items are only accessible by owner
        if document_context.deleted_at.is_some() {
            return Err(ExtractorError::UnauthorizedWithMessage(
                "only owner can access deleted resource",
            ));
        }

        let access_level = match service
            .get_access_level(
                macro_user_id.as_deref(),
                &document_context.document_id,
                EntityType::Document,
            )
            .await
            .map_err(ExtractorError::from)?
        {
            Some(access_level) => access_level,
            None => return Err(ExtractorError::Unauthorized),
        };

        let permission = EntityPermission::AccessLevel { access_level };
        if !permission.satisfies::<T>() {
            return Err(ExtractorError::Unauthorized);
        };

        Ok(Self {
            entity_access_receipt: EntityAccessReceipt {
                entity: Entity {
                    entity_id: document_context.document_id.clone(),
                    entity_type: EntityType::Document,
                },
                auth: macro_user_id
                    .map(|m| EntityAccessAuth::Authenticated(m.0))
                    .unwrap_or(EntityAccessAuth::Unauthenticated),
                entity_permission: permission,
                _marker: PhantomData,
            },
            _marker: PhantomData,
        })
    }
}
