//! Outbound (driven) adapters for collab surfaces.

#[cfg(feature = "postgres")]
pub mod document_ids;
#[cfg(feature = "postgres")]
pub mod pg_collab_surface_repo;
pub mod surface_init;

/// The collab-surface service over Postgres and the lexical/sync-service
/// clients.
#[cfg(feature = "postgres")]
pub type PgCollabSurfaceService = crate::domain::service::CollabSurfaceServiceImpl<
    pg_collab_surface_repo::PgCollabSurfaceRepo,
    surface_init::LexicalSyncSurfaceInitializer,
    document_ids::PgDocumentIds,
>;

/// Compose [`PgCollabSurfaceService`] from the host's pool and shared clients.
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
