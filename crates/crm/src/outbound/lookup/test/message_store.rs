//! Message store behavior on CRM parents, exercised through the real reader.

use ::messages::{
    domain::{
        models::*,
        ports::*,
        service::{MessageService, MessageView, MessageWrite},
    },
    outbound::pg_message_repo::PgMessageRepository,
};
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, RequiredPermission,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

use super::super::PgCrmParentReader;

const USER: &str = "macro|message-test@example.com";

async fn setup(pool: &PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'message-test', 'message-test@example.com', 'message-test')"#,
        user_id
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'message-test@example.com', $2)"#, USER, user_id)
        .execute(pool).await.unwrap();
}

fn input(content: &str, root: Option<Uuid>) -> PostMessage {
    PostMessage {
        id: None,
        attribution: Default::default(),
        notification_policy: Default::default(),
        content: content.into(),
        thread_id: root,
        anchor: None,
        mentions: vec![],
        attachments: vec![],
        nonce: None,
    }
}

struct CrmRecords {
    company: Uuid,
    contact: Uuid,
}

async fn create_team(pool: &PgPool) -> Uuid {
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'CRM team', $2)",
        team,
        USER
    )
    .execute(pool)
    .await
    .unwrap();
    team
}

async fn create_crm_records(pool: &PgPool, team: Uuid, domain: &str) -> CrmRecords {
    let company = Uuid::now_v7();
    let contact = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO crm_companies (id, team_id, first_interaction, last_interaction)
        VALUES ($1, $2, now(), now())",
        company,
        team
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)",
        company,
        team,
        domain
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO crm_contacts (id, company_id, email, first_interaction, last_interaction)
        VALUES ($1, $2, $3, now(), now())",
        contact,
        company,
        format!("person@{domain}")
    )
    .execute(pool)
    .await
    .unwrap();
    CrmRecords { company, contact }
}

fn receipt<P: RequiredPermission>(parent: &MessageParent) -> EntityAccessReceipt<P> {
    EntityAccessReceipt::try_new_authenticated_user(
        USER.to_owned().try_into().unwrap(),
        Entity {
            entity_type: parent.access_entity_type(),
            entity_id: parent.entity_id(),
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

fn repo(pool: &PgPool) -> PgMessageRepository {
    PgMessageRepository::new(pool.clone()).with_crm(PgCrmParentReader::new(pool.clone()))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crm_discussion_lifecycle_cascades_on_company_deletion(pool: PgPool) {
    setup(&pool).await;
    let team = create_team(&pool).await;
    let records = create_crm_records(&pool, team, "acme.test").await;
    let company = MessageParent::CrmCompany(records.company);
    let contact = MessageParent::CrmContact(records.contact);
    let repo = repo(&pool);
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);

    let root = service
        .post(
            receipt::<MessageWrite>(&company),
            input("Renewal call went well", None),
        )
        .await
        .unwrap();
    let mut reply_input = input("Following up", Some(root.id));
    reply_input.mentions.push(SimpleMention {
        entity_type: "user".into(),
        entity_id: USER.into(),
    });
    reply_input.attachments.push(NewAttachment {
        entity_type: "static_image".into(),
        entity_id: Uuid::now_v7().to_string(),
        width: None,
        height: None,
    });
    let reply = service.post(receipt(&company), reply_input).await.unwrap();
    assert_eq!(reply.mentions.len(), 1);
    assert_eq!(reply.attachments.len(), 1);
    service
        .react(receipt(&company), root.id, "👍".into(), true, None)
        .await
        .unwrap();
    let edited = service
        .patch(
            receipt(&company),
            reply.id,
            MessagePatch {
                content: Some("Edited follow-up".into()),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(edited.content, "Edited follow-up");
    let page = service
        .timeline(
            receipt::<MessageView>(&company),
            MessageTimelineQuery::default(),
        )
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].thread.reply_count, 1);
    assert!(matches!(
        service
            .patch_thread(
                receipt(&company),
                root.id,
                ThreadPatch {
                    detach_anchor: true,
                    ..Default::default()
                },
            )
            .await,
        Err(MessageError::Invalid(_))
    ));

    let contact_root = service
        .post(receipt(&contact), input("Prefers email", None))
        .await
        .unwrap();

    // The contact goes with its company, so both discussions go with it.
    sqlx::query!("DELETE FROM crm_companies WHERE id = $1", records.company)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        service.get_thread(receipt(&company), root.id).await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service
            .post(receipt(&contact), input("too late", None))
            .await,
        Err(MessageError::NotFound)
    ));
    let residual = sqlx::query!(r#"SELECT
        EXISTS(SELECT 1 FROM comms_messages WHERE id = ANY($1)) AS "messages!",
        EXISTS(SELECT 1 FROM comms_message_threads WHERE root_id = ANY($1)) AS "threads!",
        EXISTS(SELECT 1 FROM comms_attachments WHERE message_id = ANY($1)) AS "attachments!",
        EXISTS(SELECT 1 FROM comms_reactions WHERE message_id = ANY($1)) AS "reactions!",
        EXISTS(SELECT 1 FROM comms_entity_mentions WHERE source_entity_type = 'message' AND source_entity_id = ANY($2)) AS "mentions!""#,
        &[root.id, reply.id, contact_root.id],
        &[root.id.to_string(), reply.id.to_string(), contact_root.id.to_string()])
        .fetch_one(&pool).await.unwrap();
    assert!(
        !residual.messages
            && !residual.threads
            && !residual.attachments
            && !residual.reactions
            && !residual.mentions
    );
    let late = CreateMessage {
        parent: company,
        actor: USER.to_owned().try_into().unwrap(),
        triggered_by: None,
        input: input("race", None),
    };
    assert!(matches!(
        repo.create(late).await,
        Err(MessageError::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crm_threads_stay_within_their_record(pool: PgPool) {
    setup(&pool).await;
    let team = create_team(&pool).await;
    let first = create_crm_records(&pool, team, "first.test").await;
    let second = create_crm_records(&pool, team, "second.test").await;
    let service = MessageService::new(repo(&pool), NoMessageEventPublisher);
    let company = MessageParent::CrmCompany(first.company);
    let contact = MessageParent::CrmContact(first.contact);
    let other_company = MessageParent::CrmCompany(second.company);

    let root = service
        .post(receipt(&company), input("Company note", None))
        .await
        .unwrap();
    for wrong in [&contact, &other_company] {
        assert!(matches!(
            service
                .post(receipt(wrong), input("Wrong record", Some(root.id)))
                .await,
            Err(MessageError::NotFound)
        ));
        assert!(matches!(
            service.get(receipt::<MessageView>(wrong), root.id).await,
            Err(MessageError::NotFound)
        ));
    }
    // A contact id is not a company id, even though both are uuids.
    let as_company = MessageParent::CrmCompany(first.contact);
    assert!(matches!(
        service
            .post(receipt(&as_company), input("Mistyped", None))
            .await,
        Err(MessageError::NotFound)
    ));
    let unconfigured = MessageService::new(PgMessageRepository::new(pool), NoMessageEventPublisher);
    assert!(matches!(
        unconfigured
            .post(receipt(&company), input("No CRM reader", None))
            .await,
        Err(MessageError::NotFound)
    ));
}
