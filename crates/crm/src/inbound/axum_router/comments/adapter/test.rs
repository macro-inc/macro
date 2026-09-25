use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use messages::{
    domain::{
        ports::NoMessageEventPublisher,
        service::{MessageService, MessageView, MessageWrite},
    },
    outbound::pg_message_repo::PgMessageRepository,
};
use sqlx::PgPool;
use uuid::Uuid;

use super::CrmCommentAdapter;
use crate::{
    domain::{comment::CrmCommentEntityType, model::CrmError},
    outbound::lookup::PgCrmParentReader,
};

const AUTHOR: &str = "macro|crm-author@example.com";
const OTHER: &str = "macro|crm-other@example.com";

async fn seed_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
    )
    .bind(macro_user_id)
    .bind(id)
    .bind(format!("stripe_{macro_user_id}"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(id)
        .bind(macro_user_id)
        .execute(pool)
        .await
        .unwrap();
}

async fn seed_company(pool: &PgPool) -> Uuid {
    seed_user(pool, AUTHOR).await;
    seed_user(pool, OTHER).await;
    let team = Uuid::now_v7();
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'CRM team', $2)")
        .bind(team)
        .bind(AUTHOR)
        .execute(pool)
        .await
        .unwrap();
    let company = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction)
         VALUES ($1, $2, now(), now())",
    )
    .bind(company)
    .bind(team)
    .execute(pool)
    .await
    .unwrap();
    company
}

fn receipt<P: RequiredPermission>(user: &str, company: Uuid) -> EntityAccessReceipt<P> {
    EntityAccessReceipt::try_new_authenticated_user(
        user.to_owned().try_into().unwrap(),
        Entity {
            entity_type: EntityType::CrmCompany,
            entity_id: company.to_string(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn service(pool: &PgPool) -> MessageService<PgMessageRepository, NoMessageEventPublisher> {
    MessageService::new(
        PgMessageRepository::new(pool.clone()).with_crm(PgCrmParentReader::new(pool.clone())),
        NoMessageEventPublisher,
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_shapes_round_trip_through_the_message_store(pool: PgPool) {
    let company = seed_company(&pool).await;
    let service = service(&pool);
    let adapter = CrmCommentAdapter::new(&service);
    let kind = CrmCommentEntityType::CrmCompany;
    let view = || receipt::<MessageView>(AUTHOR, company);
    let write = |user| receipt::<MessageWrite>(user, company);

    let created = adapter
        .create(
            write(AUTHOR),
            view(),
            kind,
            company,
            None,
            "Renewal call went well",
        )
        .await
        .unwrap();
    let root = created.thread.thread_id;
    assert_eq!(created.thread.entity_id, company);
    assert_eq!(created.thread.owner, AUTHOR);
    assert_eq!(created.comments.len(), 1);
    assert_eq!(created.comments[0].comment_id, root);
    assert_eq!(created.comments[0].thread_id, root);
    assert_eq!(created.comments[0].owner, AUTHOR);

    let replied = adapter
        .create(
            write(OTHER),
            view(),
            kind,
            company,
            Some(root),
            "Following up",
        )
        .await
        .unwrap();
    assert_eq!(replied.thread.thread_id, root);
    let texts: Vec<_> = replied.comments.iter().map(|c| c.text.as_str()).collect();
    assert_eq!(texts, ["Renewal call went well", "Following up"]);
    let reply = replied.comments[1].comment_id;
    assert!(adapter.is_root(view(), root).await.unwrap());
    assert!(!adapter.is_root(view(), reply).await.unwrap());
    assert!(!adapter.is_root(view(), Uuid::now_v7()).await.unwrap());

    let second = adapter
        .create(write(AUTHOR), view(), kind, company, None, "Second thread")
        .await
        .unwrap();
    let listed = adapter.list(view(), kind, company).await.unwrap();
    let roots: Vec<_> = listed.iter().map(|t| t.thread.thread_id).collect();
    assert_eq!(roots, [root, second.thread.thread_id]);

    let edited = adapter.edit(write(OTHER), reply, "Edited").await.unwrap();
    assert_eq!(edited.text, "Edited");
    assert!(matches!(
        adapter.edit(write(OTHER), root, "Not mine").await,
        Err(CrmError::CommentNotOwned)
    ));

    let deleted_reply = adapter.delete(write(OTHER), reply).await.unwrap();
    assert_eq!(deleted_reply.thread_id, root);
    assert!(!deleted_reply.thread_deleted);
    let listed = adapter.list(view(), kind, company).await.unwrap();
    assert_eq!(listed[0].comments.len(), 1);

    let deleted_root = adapter.delete(write(AUTHOR), root).await.unwrap();
    assert!(deleted_root.thread_deleted);
    let listed = adapter.list(view(), kind, company).await.unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].thread.thread_id, second.thread.thread_id);
    assert!(matches!(
        adapter.edit(write(AUTHOR), root, "Gone").await,
        Err(CrmError::CommentNotFound)
    ));
}
