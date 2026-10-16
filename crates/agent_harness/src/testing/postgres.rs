/// Compose the real session repository for database-backed harness tests.
pub(crate) fn postgres_sessions(
    pool: sqlx::PgPool,
) -> agent_session::outbound::postgres::PgAgentSessionRepo<bots::outbound::pg_bots_repo::PgBotsRepo>
{
    let bots = bots::outbound::pg_bots_repo::PgBotsRepo::new(pool.clone());
    let registrar = entity_registry_db_utils::OwnedEntityRegistrar::new(
        entity_registry::OwnerGrantPolicy::new(bots),
    );
    agent_session::outbound::postgres::PgAgentSessionRepo::new(pool, registrar)
}
