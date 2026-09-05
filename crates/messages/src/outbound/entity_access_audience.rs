use crate::domain::{delivery::MessageAudienceAccess, models::MessageParent, service::MessageView};
use entity_access::domain::{
    models::{AccessError, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashSet;

/// Uses the existing access service to mint fresh view capabilities for delivery.
#[derive(Clone)]
pub struct EntityAccessMessageAudience<A>(pub A);

impl<A: EntityAccessService> MessageAudienceAccess for EntityAccessMessageAudience<A> {
    async fn viewers(
        &self,
        parent: &MessageParent,
        candidates: HashSet<String>,
    ) -> Result<HashSet<String>, rootcause::Report> {
        let kind = match parent {
            MessageParent::Channel(_) => EntityType::Channel,
            MessageParent::Document(_) => EntityType::Document,
            MessageParent::EmailThread(_) => EntityType::EmailThread,
        };
        let mut viewers = HashSet::new();
        for candidate in candidates {
            let Ok(user) = MacroUserIdStr::try_from(candidate.clone()) else {
                continue;
            };
            // No organization is asserted on behalf of a recipient. The access
            // service resolves current direct, inherited, and mailbox access.
            match self
                .0
                .generate_entity_access_receipt::<MessageView>(
                    &user.0,
                    None,
                    &parent.entity_id(),
                    kind,
                )
                .await
            {
                Ok(_) => {
                    viewers.insert(candidate);
                }
                Err(AccessError::Unavailable(error) | AccessError::Internal(error)) => {
                    return Err(error);
                }
                Err(_) => {}
            }
        }
        Ok(viewers)
    }
}

/// Adapts existing entity access receipts to the message reference boundary.
#[derive(Clone)]
pub struct EntityAccessMessageReferences<A>(pub A);

impl<A: EntityAccessService> crate::domain::ports::MessageReferenceAccess
    for EntityAccessMessageReferences<A>
{
    fn can_view<'a>(
        &'a self,
        auth: &'a entity_access::domain::models::EntityAccessAuth,
        entity_type: EntityType,
        entity_id: &'a str,
    ) -> std::pin::Pin<
        Box<dyn Future<Output = Result<bool, crate::domain::ports::MessageError>> + Send + 'a>,
    > {
        Box::pin(async move {
            let entity_access::domain::models::EntityAccessAuth::Authenticated(user) = auth else {
                return Ok(false);
            };
            match self
                .0
                .generate_entity_access_receipt::<MessageView>(
                    &user.0,
                    None,
                    entity_id,
                    entity_type,
                )
                .await
            {
                Ok(_) => Ok(true),
                Err(AccessError::Unavailable(error) | AccessError::Internal(error)) => {
                    Err(crate::domain::ports::MessageError::Repository(error))
                }
                Err(_) => Ok(false),
            }
        })
    }
}
