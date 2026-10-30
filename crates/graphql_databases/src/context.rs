//! The inbound receipt boundary and request capabilities supplied by DSS.

use std::{future::Future, pin::Pin, sync::Arc};

use databases::domain::{models::Viewer, receipt::database_receipt};
use databases_sql::view_rows::{ViewRowsPage, ViewRowsRequest, ViewRowsService};
use entity_access::domain::{models::ViewAccessLevel, ports::EntityAccessService};
use graphql_soup::SoupItemDataLoader;
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::DatabaseId;

pub(crate) type PageFuture<'a> =
    Pin<Box<dyn Future<Output = async_graphql::Result<ViewRowsPage>> + Send + 'a>>;

pub(crate) trait DatabaseRowsApi: Send + Sync {
    fn page(
        &self,
        user: MacroUserIdStr<'static>,
        database: DatabaseId,
        request: ViewRowsRequest,
    ) -> PageFuture<'_>;
}

/// View-page service and primary entity loader, without schema-level generics.
#[derive(Clone)]
pub struct DatabaseRowsGraphqlContext {
    pub(crate) api: Arc<dyn DatabaseRowsApi>,
    pub(crate) loader: SoupItemDataLoader,
}

impl DatabaseRowsGraphqlContext {
    /// Compose the use case, receipt minting and primary row hydration.
    pub fn new<S: ViewRowsService, A: EntityAccessService>(
        service: S,
        access: Arc<A>,
        loader: SoupItemDataLoader,
    ) -> Self {
        Self {
            api: Arc::new(Adapter { service, access }),
            loader,
        }
    }
}

struct Adapter<S, A> {
    service: S,
    access: Arc<A>,
}

impl<S: ViewRowsService, A: EntityAccessService> DatabaseRowsApi for Adapter<S, A> {
    fn page(
        &self,
        user: MacroUserIdStr<'static>,
        database: DatabaseId,
        request: ViewRowsRequest,
    ) -> PageFuture<'_> {
        Box::pin(async move {
            let receipt = database_receipt::<ViewAccessLevel, _>(
                self.access.as_ref(),
                &Viewer {
                    user_id: user,
                    acting_bot: None,
                },
                database,
            )
            .await
            .map_err(|_| async_graphql::Error::new("not found"))?;
            self.service
                .page(receipt, request)
                .await
                .map_err(super::graphql_error)
        })
    }
}
