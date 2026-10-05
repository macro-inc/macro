//! Authenticated known-document reads, independent of Soup discovery eligibility.

use std::{future::Future, pin::Pin, sync::Arc};

use async_graphql::futures_util::{StreamExt, TryStreamExt, stream};
use async_graphql::{Context, ID};
use documents::domain::{models::ViewedDocumentMetadata, ports::metadata::DocumentMetadataService};
use entity_access::domain::{
    models::{AccessError, EntityType, ViewAccessLevel},
    ports::EntityAccessService,
};
use graphql_common::parse_id;
use graphql_soup::{GraphqlSoupDocument, GraphqlSoupEntity, SoupEntityEdges};
use macro_user_id::user_id::MacroUserIdStr;
use models_soup::{
    document::{SoupDocument, SoupDocumentSubType},
    item::SoupItem,
};
use uuid::Uuid;

/// The maximum number of explicitly addressed documents in one request.
const MAX_DOCUMENT_IDS: usize = 100;

/// Object-safe future forwarding the request to domain services.
type DocumentReadFuture<'a> = Pin<
    Box<dyn Future<Output = async_graphql::Result<Option<ViewedDocumentMetadata>>> + Send + 'a>,
>;

/// Receipt-minting bridge to the document domain service.
trait DocumentApi: Send + Sync {
    /// Authorize the viewer before reading any document metadata.
    fn read(&self, user: MacroUserIdStr<'static>, id: Uuid) -> DocumentReadFuture<'_>;
}

/// Known-document capability supplied by the application composition root.
#[derive(Clone)]
pub struct DocumentGraphqlContext(Arc<dyn DocumentApi>);

impl DocumentGraphqlContext {
    /// Compose document metadata reads with the canonical receipt-minting service.
    pub fn new<S: DocumentMetadataService, A: EntityAccessService>(
        service: Arc<S>,
        access: Arc<A>,
    ) -> Self {
        Self(Arc::new(DocumentApiAdapter { service, access }))
    }
}

/// Thin inbound adapter; document policy remains in the domain services.
struct DocumentApiAdapter<S, A> {
    /// Receipt-gated document use case.
    service: Arc<S>,
    /// Canonical entity access boundary.
    access: Arc<A>,
}

impl<S: DocumentMetadataService, A: EntityAccessService> DocumentApi for DocumentApiAdapter<S, A> {
    fn read(&self, user: MacroUserIdStr<'static>, id: Uuid) -> DocumentReadFuture<'_> {
        Box::pin(async move {
            let receipt = match self
                .access
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    &user,
                    None,
                    &id.to_string(),
                    EntityType::Document,
                )
                .await
            {
                Ok(receipt) => receipt,
                Err(
                    AccessError::Unauthorized
                    | AccessError::UnauthorizedWithMessage(_)
                    | AccessError::NotFound(_),
                ) => return Ok(None),
                Err(error) => return Err(async_graphql::Error::new(error.to_string())),
            };
            self.service
                .viewed_metadata(receipt)
                .await
                .map_err(Into::into)
        })
    }
}

/// Convert the domain metadata to the existing normalized document contract.
fn document_item(metadata: ViewedDocumentMetadata) -> async_graphql::Result<SoupDocument<()>> {
    let document = metadata.document;
    Ok(SoupDocument {
        id: Uuid::parse_str(&document.document_id)?,
        document_version_id: document.document_version_id,
        owner_id: document.owner,
        name: document.document_name,
        file_type: document.file_type,
        sha: document.sha,
        project_id: document
            .project_id
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()?,
        branched_from_id: document
            .branched_from_id
            .as_deref()
            .map(Uuid::parse_str)
            .transpose()?,
        branched_from_version_id: document.branched_from_version_id,
        document_family_id: document.document_family_id,
        created_at: document
            .created_at
            .ok_or_else(|| async_graphql::Error::new("Missing document creation timestamp"))?,
        updated_at: document
            .updated_at
            .ok_or_else(|| async_graphql::Error::new("Missing document update timestamp"))?,
        viewed_at: metadata.view.viewed_at,
        sub_type: SoupDocumentSubType::from_db(document.sub_type, Some(metadata.is_completed)),
        deleted_at: document.deleted_at,
        extra: (),
    })
}

/// Resolve one known document without checking or changing Soup membership.
pub(crate) async fn resolve_document<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    user: MacroUserIdStr<'static>,
    id: ID,
) -> async_graphql::Result<Option<GraphqlSoupDocument<E>>> {
    let id = parse_id(id, "documentId")?;
    let Some(metadata) = ctx
        .data::<DocumentGraphqlContext>()?
        .0
        .read(user, id)
        .await?
    else {
        return Ok(None);
    };
    match GraphqlSoupEntity::<E>::new(SoupItem::Document(document_item(metadata)?)) {
        GraphqlSoupEntity::Document(document) => Ok(Some(document)),
        _ => unreachable!("document item constructs a document entity"),
    }
}

/// Resolve a bounded set of caller-supplied IDs, with a fresh receipt per document.
pub(crate) async fn resolve_documents<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    user: MacroUserIdStr<'static>,
    ids: Vec<ID>,
) -> async_graphql::Result<Vec<GraphqlSoupDocument<E>>> {
    if ids.len() > MAX_DOCUMENT_IDS {
        return Err(async_graphql::Error::new(
            "At most 100 document IDs are allowed",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    let ids: Vec<_> = ids
        .into_iter()
        .filter(|id| seen.insert(id.to_string()))
        .collect();
    let documents: Vec<_> = stream::iter(ids)
        .map(|id| resolve_document(ctx, user.clone(), id))
        .buffered(10)
        .try_collect()
        .await?;
    Ok(documents.into_iter().flatten().collect())
}
