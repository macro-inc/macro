//! GraphQL transport adapter for saved-view definitions.
use async_graphql::{Context, ErrorExtensions, ID, InputObject, Json, Object, SimpleObject};
use saved_views::{
    View,
    domain::{Cursor, Error, SavedViewApi, ShareChange, Update},
};
use std::sync::Arc;
use uuid::Uuid;

/// A saved filter definition, not a snapshot of matching entities.
#[derive(SimpleObject)]
pub struct GraphqlSavedView {
    /// Stable identity of this saved definition.
    id: ID,
    /// User who owns and can edit this definition.
    owner_id: ID,
    /// Display name chosen by the owner.
    name: String,
    /// Versioned filter configuration interpreted by the consuming feature.
    config: Json<serde_json::Value>,
    /// Team with effective access, or null when the definition is private.
    shared_team_id: Option<ID>,
    /// Current revision required for conditional updates and deletion.
    revision: i64,
    /// Creation timestamp in RFC 3339 format.
    created_at: String,
    /// Last update timestamp in RFC 3339 format.
    updated_at: String,
}

impl From<View> for GraphqlSavedView {
    fn from(view: View) -> Self {
        Self {
            id: view.id.into(),
            owner_id: view.user_id.into(),
            name: view.name,
            config: Json(view.config),
            shared_team_id: view.shared_team_id.map(Into::into),
            revision: view.revision,
            created_at: view.created_at.to_rfc3339(),
            updated_at: view.updated_at.to_rfc3339(),
        }
    }
}

/// A page ordered by creation time and ID after effective visibility checks.
#[derive(SimpleObject)]
pub struct GraphqlSavedViewPage {
    /// Definitions the authenticated viewer can currently access.
    nodes: Vec<GraphqlSavedView>,
    /// Opaque continuation cursor, or null when the listing is complete.
    next_cursor: Option<String>,
}

/// Map domain failures to stable GraphQL error codes without exposing internal details.
fn error(error: Error) -> async_graphql::Error {
    let code = match error {
        Error::NotFound | Error::NotOwner => "NOT_FOUND",
        Error::Conflict => "CONFLICT",
        Error::Invalid => "INVALID",
        Error::NotMember => "FORBIDDEN",
        Error::Internal(ref e) => {
            tracing::error!(error = ?e, "saved view failure");
            "INTERNAL"
        }
    };
    async_graphql::Error::new(error.to_string()).extend_with(|_, ext| ext.set("code", code))
}

/// Parse a transport ID into the saved-view UUID used by the domain.
fn parse_id(id: ID) -> async_graphql::Result<Uuid> {
    Uuid::parse_str(id.as_str()).map_err(|_| async_graphql::Error::new("invalid saved view ID"))
}

/// Resolve the request-scoped saved-view domain service.
fn service(ctx: &Context<'_>) -> async_graphql::Result<Arc<dyn SavedViewApi>> {
    Ok(ctx.data::<Arc<dyn SavedViewApi>>()?.clone())
}

/// Read a visible page for an authenticated GraphQL user.
#[tracing::instrument(
    name = "saved_view.graphql_list",
    skip_all,
    fields(first, kind),
    err(Debug)
)]
pub async fn list(
    ctx: &Context<'_>,
    viewer: &str,
    kind: Option<String>,
    first: Option<i32>,
    after: Option<String>,
) -> async_graphql::Result<GraphqlSavedViewPage> {
    let first = first.unwrap_or(25);
    if !(1..=50).contains(&first) {
        return Err(error(Error::Invalid));
    }
    let after = after
        .map(|raw| {
            serde_json::from_str::<(chrono::DateTime<chrono::Utc>, Uuid)>(&raw)
                .map(|(created_at, id)| Cursor { created_at, id })
                .map_err(|_| error(Error::Invalid))
        })
        .transpose()?;
    let page = service(ctx)?
        .list(viewer, kind.as_deref(), after, first as u32)
        .await
        .map_err(error)?;
    Ok(GraphqlSavedViewPage {
        nodes: page.views.into_iter().map(Into::into).collect(),
        next_cursor: page
            .next
            .map(|c| serde_json::to_string(&(c.created_at, c.id)))
            .transpose()
            .map_err(|_| error(Error::Invalid))?,
    })
}

/// Load a view only when the caller still has definition access.
#[tracing::instrument(name = "saved_view.graphql_get", skip_all, fields(view_id = id.as_str()), err(Debug))]
pub async fn get(
    ctx: &Context<'_>,
    viewer: &str,
    id: ID,
) -> async_graphql::Result<Option<GraphqlSavedView>> {
    match service(ctx)?.get(viewer, parse_id(id)?).await {
        Ok(view) => Ok(Some(view.into())),
        Err(Error::NotFound) => Ok(None),
        Err(err) => Err(error(err)),
    }
}

/// Inputs for creating a saved view with a stable client-generated identity.
#[derive(InputObject)]
pub struct CreateSavedViewInput {
    /// Client-generated UUID reused when retrying the same creation.
    id: ID,
    /// Nonempty display name, limited to 120 characters.
    name: String,
    /// Consumer-owned JSON object, limited to 32 KiB.
    config: Json<serde_json::Value>,
    /// Current team to share with, or null for a private definition.
    shared_team_id: Option<ID>,
}

/// Explicit sharing action: an omitted input leaves sharing unchanged; null team ID makes it private.
#[derive(InputObject)]
pub struct SavedViewSharingInput {
    /// Current team to share with; null explicitly removes sharing.
    team_id: Option<ID>,
}

/// Inputs for a revision-guarded replacement update.
#[derive(InputObject)]
pub struct UpdateSavedViewInput {
    /// Identity of the definition to update.
    id: ID,
    /// Revision that must still match when the update commits.
    expected_revision: i64,
    /// Replacement display name; omission preserves the current name.
    name: Option<String>,
    /// Complete replacement configuration; omission preserves current filters.
    config: Option<Json<serde_json::Value>>,
    /// Explicit sharing change; omission preserves the existing share.
    sharing: Option<SavedViewSharingInput>,
}

/// Inputs for a revision-guarded deletion.
#[derive(InputObject)]
pub struct DeleteSavedViewInput {
    /// Identity of the definition to delete.
    id: ID,
    /// Revision that must still match when the deletion commits.
    expected_revision: i64,
}

/// Owner-scoped saved-view mutations.
#[derive(Default)]
pub struct SavedViewMutationRoot;

#[Object]
impl SavedViewMutationRoot {
    /// Create once; replaying the same owned ID returns its existing record.
    async fn create_saved_view(
        &self,
        ctx: &Context<'_>,
        input: CreateSavedViewInput,
    ) -> async_graphql::Result<GraphqlSavedView> {
        let viewer = ctx.data::<macro_user_id::user_id::MacroUserIdStr<'static>>()?;
        service(ctx)?
            .create(
                viewer.as_ref(),
                parse_id(input.id)?,
                input.name,
                input.config.0,
                input.shared_team_id.map(parse_id).transpose()?,
            )
            .await
            .map(Into::into)
            .map_err(error)
    }

    /// Replace supplied fields only if the caller owns the expected revision.
    async fn update_saved_view(
        &self,
        ctx: &Context<'_>,
        input: UpdateSavedViewInput,
    ) -> async_graphql::Result<GraphqlSavedView> {
        let viewer = ctx.data::<macro_user_id::user_id::MacroUserIdStr<'static>>()?;
        let share = match input.sharing {
            None => ShareChange::Unchanged,
            Some(SavedViewSharingInput { team_id: None }) => ShareChange::Private,
            Some(SavedViewSharingInput {
                team_id: Some(team),
            }) => ShareChange::Team(parse_id(team)?),
        };
        service(ctx)?
            .update(
                viewer.as_ref(),
                parse_id(input.id)?,
                input.expected_revision,
                Update {
                    name: input.name,
                    config: input.config.map(|c| c.0),
                    share,
                },
            )
            .await
            .map(Into::into)
            .map_err(error)
    }

    /// Delete the expected owned revision; repeating a completed deletion returns the ID.
    async fn delete_saved_view(
        &self,
        ctx: &Context<'_>,
        input: DeleteSavedViewInput,
    ) -> async_graphql::Result<ID> {
        let viewer = ctx.data::<macro_user_id::user_id::MacroUserIdStr<'static>>()?;
        service(ctx)?
            .delete(
                viewer.as_ref(),
                parse_id(input.id)?,
                input.expected_revision,
            )
            .await
            .map(Into::into)
            .map_err(error)
    }
}
