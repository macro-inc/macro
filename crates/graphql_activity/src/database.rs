use async_graphql::{Context, ErrorExtensions as _, ID};
use entity_access::domain::{
    models::{AccessError, ViewAccessLevel},
    ports::EntityAccessService,
};
use graphql_common::parse_id;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

use crate::{
    loaders::{
        ActivityEdgeKey, SoupActivityEdgeReader, load_entity_activity, parse_activity_edge_limit,
    },
    objects::GraphqlActivityEvent,
};

/// The newest activity on a database the viewer can view, newest first. A
/// database the viewer cannot view reads as not found, never confirming it exists.
pub async fn resolve_database_activity<Reader, Access>(
    ctx: &Context<'_>,
    access: &Access,
    viewer: &MacroUserIdStr<'static>,
    database_id: ID,
    limit: Option<i32>,
) -> async_graphql::Result<Vec<GraphqlActivityEvent>>
where
    Reader: SoupActivityEdgeReader,
    Access: EntityAccessService,
{
    let database_id = parse_id(database_id, "databaseId")?;
    let limit = parse_activity_edge_limit(limit)?;
    let receipt = access
        .generate_entity_access_receipt::<ViewAccessLevel>(
            viewer,
            None,
            &database_id.to_string(),
            EntityType::Database,
        )
        .await
        .map_err(access_error)?;
    load_entity_activity::<Reader>(
        ctx,
        ActivityEdgeKey {
            entity: EntityType::Database.with_entity_string(receipt.entity().entity_id.clone()),
            limit,
        },
    )
    .await
}

/// An access failure as the field reports it: every refusal is "not found".
fn access_error(error: AccessError) -> async_graphql::Error {
    let (message, code) = match error {
        AccessError::NotFound(_)
        | AccessError::Unauthorized
        | AccessError::UnauthorizedWithMessage(_)
        | AccessError::BadRequest(_) => ("database not found", "NOT_FOUND"),
        error => {
            tracing::error!(?error, "database activity authorization failed");
            ("internal server error", "INTERNAL_SERVER_ERROR")
        }
    };
    async_graphql::Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", code);
    })
}
