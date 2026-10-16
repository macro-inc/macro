//! Outbound (driven) adapters for collab surfaces.

#[cfg(feature = "postgres")]
pub mod document_ids;
#[cfg(feature = "postgres")]
pub mod pg_collab_surface_repo;
pub mod surface_init;

/// The collab-surface service over Postgres and the lexical/sync-service
/// clients. It serves the public API once given the forms domain's ids
/// ([`CollabSurfaceServiceImpl::with_form_ids`]); without them, only
/// [`OwnedSurfaceService`].
///
/// [`CollabSurfaceServiceImpl::with_form_ids`]: crate::domain::service::CollabSurfaceServiceImpl::with_form_ids
/// [`OwnedSurfaceService`]: crate::domain::ports::OwnedSurfaceService
#[cfg(feature = "postgres")]
pub type PgCollabSurfaceService<Forms = crate::domain::service::OwnedSurfacesOnly> =
    crate::domain::service::CollabSurfaceServiceImpl<
        pg_collab_surface_repo::PgCollabSurfaceRepo,
        surface_init::LexicalSyncSurfaceInitializer,
        document_ids::PgDocumentIds,
        Forms,
    >;

/// Compose the owned-surface [`PgCollabSurfaceService`] from the host's pool
/// and shared clients.
#[cfg(feature = "postgres")]
pub fn pg_collab_surface_service(
    pool: sqlx::PgPool,
    lexical_client: lexical_client::LexicalClient,
    sync_service_client: sync_service_client::SyncServiceClient,
    jwt_secret: String,
) -> PgCollabSurfaceService {
    PgCollabSurfaceService::new(
        std::sync::Arc::new(pg_collab_surface_repo::PgCollabSurfaceRepo::new(
            pool.clone(),
        )),
        std::sync::Arc::new(surface_init::LexicalSyncSurfaceInitializer::new(
            lexical_client,
            sync_service_client,
        )),
        std::sync::Arc::new(document_ids::PgDocumentIds::new(pool)),
        jwt_secret,
    )
}
