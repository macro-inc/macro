//! Outbound (driven) adapters for collab surfaces.

#[cfg(feature = "postgres")]
pub mod pg_collab_surface_repo;
pub mod surface_init;

/// The collab-surface service over Postgres and the lexical/sync-service
/// clients, with the host's view of the document id namespace.
#[cfg(feature = "postgres")]
pub type PgCollabSurfaceService<D> = crate::domain::service::CollabSurfaceServiceImpl<
    pg_collab_surface_repo::PgCollabSurfaceRepo,
    surface_init::LexicalSyncSurfaceInitializer,
    D,
>;

/// Compose [`PgCollabSurfaceService`] from the host's shared clients.
#[cfg(feature = "postgres")]
pub fn pg_collab_surface_service<D>(
    pool: sqlx::PgPool,
    lexical_client: lexical_client::LexicalClient,
    sync_service_client: sync_service_client::SyncServiceClient,
    document_ids: D,
    jwt_secret: String,
) -> PgCollabSurfaceService<D> {
    PgCollabSurfaceService::new(
        std::sync::Arc::new(pg_collab_surface_repo::PgCollabSurfaceRepo::new(pool)),
        std::sync::Arc::new(surface_init::LexicalSyncSurfaceInitializer::new(
            lexical_client,
            sync_service_client,
        )),
        std::sync::Arc::new(document_ids),
        jwt_secret,
    )
}
