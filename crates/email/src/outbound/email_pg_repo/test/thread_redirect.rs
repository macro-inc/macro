use super::*;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityPermission, EntityType,
    ViewAccessLevel,
};

fn source() -> Uuid {
    uuid::uuid!("33333333-3333-3333-3333-333333333333")
}
fn canonical() -> Uuid {
    uuid::uuid!("11111111-1111-1111-1111-111111111111")
}
fn inbox() -> Uuid {
    uuid::uuid!("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
}
async fn alias(pool: &Pool<Postgres>, target: Uuid) -> anyhow::Result<()> {
    sqlx::query!("DELETE FROM email_messages WHERE thread_id = $1", source())
        .execute(pool)
        .await?;
    sqlx::query!(
        "INSERT INTO email_thread_client_ids (client_id, link_id, thread_id) VALUES ($1, $2, $3)",
        source(),
        inbox(),
        target,
    )
    .execute(pool)
    .await?;
    Ok(())
}
fn receipt(auth: EntityAccessAuth, id: Uuid) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new(
        auth,
        Entity {
            entity_type: EntityType::EmailThread,
            entity_id: id.to_string(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn thread_redirect_requires_independent_inbox_access(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    alias(&pool, canonical()).await?;
    let service = super::thread_unread::service(pool.clone());
    let owner = MacroUserIdStr::try_from_email("user1@test.com")?;
    assert_eq!(
        service
            .resolve_thread_read_id_impl(owner.clone(), source())
            .await?,
        canonical()
    );
    let fetched = service
        .get_thread_with_messages_impl(
            receipt(EntityAccessAuth::Authenticated(owner), source()),
            0,
            20,
        )
        .await?
        .unwrap();
    assert_eq!(fetched.row.db_id, canonical());
    assert!(!fetched.messages.is_empty());
    // A share to the retained source does not grant the target's other mail.
    for auth in [
        EntityAccessAuth::Authenticated(MacroUserIdStr::try_from_email("stranger@test.com")?),
        EntityAccessAuth::Unauthenticated,
    ] {
        let fetched = service
            .get_thread_with_messages_impl(receipt(auth, source()), 0, 20)
            .await?
            .unwrap();
        assert_eq!(fetched.row.db_id, source());
        assert!(fetched.messages.is_empty());
    }
    assert_eq!(
        EmailPgRepo::new(pool)
            .redirected_thread_id(source(), &[])
            .await?,
        None
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn thread_redirect_never_crosses_inboxes(pool: Pool<Postgres>) -> anyhow::Result<()> {
    alias(&pool, uuid::uuid!("cccccccc-0000-0000-0000-0000000000c4")).await?;
    let actor = MacroUserIdStr::try_from_email("user1@test.com")?;
    assert_eq!(
        super::thread_unread::service(pool)
            .resolve_thread_read_id_impl(actor, source())
            .await?,
        source()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn thread_redirect_checks_global_emptiness_not_the_requested_page(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    sqlx::query!(
        "INSERT INTO email_thread_client_ids (client_id, link_id, thread_id) VALUES ($1, $2, $3)",
        canonical(),
        inbox(),
        source(),
    )
    .execute(&pool)
    .await?;
    let service = super::thread_unread::service(pool);
    let actor = MacroUserIdStr::try_from_email("user1@test.com")?;
    assert_eq!(
        service
            .resolve_thread_read_id_impl(actor.clone(), canonical())
            .await?,
        canonical()
    );
    let fetched = service
        .get_thread_with_messages_impl(
            receipt(EntityAccessAuth::Authenticated(actor), canonical()),
            100,
            20,
        )
        .await?
        .unwrap();
    assert_eq!(fetched.row.db_id, canonical());
    assert!(fetched.messages.is_empty());
    Ok(())
}
