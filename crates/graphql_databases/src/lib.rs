//! The viewer's paginated database views, returning canonical Soup row entities.

#![deny(missing_docs)]

mod context;
mod inputs;

use async_graphql::{Context, ErrorExtensions, ID, SimpleObject};
use databases::domain::{models::DatabaseError, view_rows::ViewRowsError};
use databases_sql::view_rows::ViewPageError;
use graphql_common::{parse_id, require_authenticated_user};
use graphql_soup::{GraphqlSoupDatabaseRow, GraphqlSoupEntity, SoupEntityEdges};
use model_entity::EntityType;
use models_databases::DatabaseId;

pub use context::DatabaseRowsGraphqlContext;
pub use inputs::DatabaseViewRowsInput;

/// Membership and order belong to this page; row facts retain their shared identity.
#[derive(SimpleObject)]
pub struct DatabaseViewRowsPage<E: SoupEntityEdges> {
    /// Rows in global view order, hydrated as canonical Soup entities.
    items: Vec<GraphqlSoupDatabaseRow<E>>,
    /// Continuation for the next page; absent at the end of the result.
    next_cursor: Option<String>,
    /// Table version against which this page was selected.
    version: i64,
}

fn graphql_error(error: ViewPageError) -> async_graphql::Error {
    let (code, message) = match &error {
        ViewPageError::Read(ViewRowsError::Stale) => ("DATABASE_VIEW_STALE", error.to_string()),
        ViewPageError::View(_) => ("DATABASE_VIEW_INVALID", error.to_string()),
        ViewPageError::Read(ViewRowsError::Infrastructure(_))
        | ViewPageError::Database(DatabaseError::Repo(_)) => (
            "INTERNAL_SERVER_ERROR",
            "The database view could not be read.".into(),
        ),
        ViewPageError::Database(DatabaseError::NotFound | DatabaseError::Unauthorized) => {
            ("NOT_FOUND", "not found".into())
        }
        _ => ("BAD_USER_INPUT", error.to_string()),
    };
    tracing::warn!(error = ?error, code, "database view read failed");
    async_graphql::Error::new(message).extend_with(|_, extensions| extensions.set("code", code))
}

/// Resolve one authorized page, then hydrate its rows through the shared entity contract.
pub async fn resolve_database_view_rows<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    database_id: ID,
    input: DatabaseViewRowsInput,
) -> async_graphql::Result<DatabaseViewRowsPage<E>> {
    let user = require_authenticated_user(ctx)?;
    let context = ctx.data::<DatabaseRowsGraphqlContext>()?;
    let database = DatabaseId::from_uuid(parse_id(database_id, "databaseId")?);
    let page = context
        .api
        .page(user.clone(), database, input.into_request()?)
        .await?;
    let keys = page
        .rows
        .iter()
        .map(|row| {
            (
                user.clone(),
                EntityType::DatabaseRow.with_entity_string(row.to_string()),
            )
        })
        .collect::<Vec<_>>();
    let loaded =
        futures::future::try_join_all(keys.into_iter().map(|key| context.loader.load_one(key)))
            .await?;
    let items = loaded
        .into_iter()
        .map(|item| {
            let item = item.ok_or_else(|| graphql_error(ViewRowsError::Stale.into()))?;
            match GraphqlSoupEntity::<E>::new_with_projection(item) {
                GraphqlSoupEntity::DatabaseRow(row) => Ok(row),
                _ => Err(async_graphql::Error::new("expected a database row")),
            }
        })
        .collect::<async_graphql::Result<Vec<_>>>()?;
    Ok(DatabaseViewRowsPage {
        items,
        next_cursor: page.next_cursor,
        version: page.version.0,
    })
}

#[cfg(test)]
mod test;
