use async_graphql::{Context, ErrorExtensions as _, ID};
use entity_access::domain::{
    models::{AccessError, EditAccessLevel, RequiredPermission, ViewAccessLevel},
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
    resolve_entity_activity::<ViewAccessLevel, Reader, Access>(
        ctx,
        access,
        viewer,
        Timeline {
            entity_type: EntityType::Database,
            id_field: "databaseId",
            not_found: "database not found",
        },
        database_id,
        limit,
    )
    .await
}

/// The newest activity on a form the viewer can edit, newest first. A form's
/// timeline names everyone who responded and when, which only its editors
/// may know: View is the respondent tier (a channel the form was posted in,
/// or any signed-in visitor of a public form). A form the viewer cannot edit
/// reads as not found, never confirming it exists.
pub async fn resolve_form_activity<Reader, Access>(
    ctx: &Context<'_>,
    access: &Access,
    viewer: &MacroUserIdStr<'static>,
    form_id: ID,
    limit: Option<i32>,
) -> async_graphql::Result<Vec<GraphqlActivityEvent>>
where
    Reader: SoupActivityEdgeReader,
    Access: EntityAccessService,
{
    resolve_entity_activity::<EditAccessLevel, Reader, Access>(
        ctx,
        access,
        viewer,
        Timeline {
            entity_type: EntityType::Form,
            id_field: "formId",
            not_found: "form not found",
        },
        form_id,
        limit,
    )
    .await
}

/// Which entity kind a timeline field reads, and how it names refusals.
struct Timeline {
    /// The entity kind the id names.
    entity_type: EntityType,
    /// The GraphQL argument carrying the id, for parse errors.
    id_field: &'static str,
    /// The message every access refusal reports.
    not_found: &'static str,
}

/// The newest activity on one entity behind a receipt at `Level`.
async fn resolve_entity_activity<Level, Reader, Access>(
    ctx: &Context<'_>,
    access: &Access,
    viewer: &MacroUserIdStr<'static>,
    timeline: Timeline,
    entity_id: ID,
    limit: Option<i32>,
) -> async_graphql::Result<Vec<GraphqlActivityEvent>>
where
    Level: RequiredPermission,
    Reader: SoupActivityEdgeReader,
    Access: EntityAccessService,
{
    let entity_id = parse_id(entity_id, timeline.id_field)?;
    let limit = parse_activity_edge_limit(limit)?;
    let receipt = access
        .generate_entity_access_receipt::<Level>(
            viewer,
            None,
            &entity_id.to_string(),
            timeline.entity_type,
        )
        .await
        .map_err(|error| access_error(&timeline, error))?;
    load_entity_activity::<Reader>(
        ctx,
        ActivityEdgeKey {
            entity: timeline
                .entity_type
                .with_entity_string(receipt.entity().entity_id.clone()),
            limit,
        },
    )
    .await
}

/// An access failure as the field reports it: every refusal is "not found".
fn access_error(timeline: &Timeline, error: AccessError) -> async_graphql::Error {
    let (message, code) = match error {
        AccessError::NotFound(_)
        | AccessError::Unauthorized
        | AccessError::UnauthorizedWithMessage(_)
        | AccessError::BadRequest(_) => (timeline.not_found, "NOT_FOUND"),
        error => {
            tracing::error!(
                ?error,
                entity_type = %timeline.entity_type,
                "activity timeline authorization failed"
            );
            ("internal server error", "INTERNAL_SERVER_ERROR")
        }
    };
    async_graphql::Error::new(message).extend_with(|_, extensions| {
        extensions.set("code", code);
    })
}
