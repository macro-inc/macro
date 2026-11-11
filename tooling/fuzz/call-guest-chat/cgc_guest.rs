use messages::domain::{
    ports::{MessageError, MessageEvent, MessageEventPublisher},
    service::{
        MessageService,
        guest_chat::{
            GuestCallAccess, GuestCallAuthorizer, GuestChatApi, GuestChatPost, GuestChatService,
        },
    },
};
use messages::outbound::pg_message_repo::PgMessageRepository;
use serde_json::json;
use sqlx::{PgPool, Row};
use std::{path::PathBuf, sync::Arc};
use uuid::Uuid;

struct Authorizer;

#[async_trait::async_trait]
impl GuestCallAuthorizer for Authorizer {
    async fn authorize(
        &self,
        _call_id: Uuid,
        _token: &str,
    ) -> Result<GuestCallAccess, MessageError> {
        Ok(GuestCallAccess {
            guest_id: Uuid::from_u128(10268),
            name: "Visitor".into(),
        })
    }
}

struct NoEvents;

impl MessageEventPublisher for NoEvents {
    async fn publish(&self, _: MessageEvent) -> Result<(), rootcause::Report> {
        Ok(())
    }
}

#[tokio::test]
#[ignore]
async fn guest_projection_and_quote_storage() {
    let output = PathBuf::from(std::env::var("CGC_OUTPUT_DIR").expect("output dir"));
    let pool = PgPool::connect(&std::env::var("CGC_DATABASE_URL").expect("database URL"))
        .await
        .expect("scratch database");
    let rows = sqlx::query(
        "SELECT DISTINCT parent_entity_id FROM comms_messages WHERE parent_entity_type = 'call' ORDER BY parent_entity_id"
    ).fetch_all(&pool).await.expect("calls");
    let identities = sqlx::query("SELECT id, email FROM \"User\" WHERE id LIKE 'macro|%'")
        .fetch_all(&pool)
        .await
        .expect("account identities");
    let service = GuestChatService::new(
        Arc::new(MessageService::new(
            PgMessageRepository::new(pool.clone()),
            NoEvents,
        )),
        Arc::new(Authorizer),
    );
    let mut checked = 0;
    let mut quotes = 0;
    for row in rows {
        let call_id: Uuid = row
            .get::<String, _>("parent_entity_id")
            .parse()
            .expect("call id");
        let value = service
            .read_thread(call_id, "probe")
            .await
            .expect("guest thread");
        let serialized = serde_json::to_string(&value).expect("guest JSON");
        assert!(
            !serialized.contains("macro|"),
            "account prefix in guest thread {call_id}"
        );
        for identity in &identities {
            let id: String = identity.get("id");
            let email: String = identity.get("email");
            assert!(
                !serialized.contains(&id),
                "account id in guest thread {call_id}"
            );
            assert!(
                !serialized.contains(&email),
                "account email in guest thread {call_id}"
            );
        }
        checked += 1;
        let Some(thread) = value.thread else {
            continue;
        };
        let member = std::iter::once(&thread.root)
            .chain(thread.replies.iter())
            .find(|message| message.sender_id.as_ref().starts_with("participant:"));
        let Some(member) = member else {
            continue;
        };
        let real_sender: String =
            sqlx::query_scalar("SELECT sender_id FROM comms_messages WHERE id = $1")
                .bind(member.id)
                .fetch_one(&pool)
                .await
                .expect("member sender");
        let body = format!(
            "<m-reply-target>{{\"parent\":{{\"type\":\"call\",\"id\":\"{call_id}\"}},\"targetMessageId\":\"{}\",\"targetThreadId\":\"{call_id}\",\"displayText\":\"quoted\",\"senderId\":\"{}\"}}</m-reply-target>\n\nreply",
            member.id,
            member.sender_id.as_ref()
        );
        let message_id = Uuid::now_v7();
        service
            .post_message(
                call_id,
                "probe",
                GuestChatPost {
                    id: message_id,
                    content: body,
                },
            )
            .await
            .expect("guest quote post");
        let stored: String =
            sqlx::query_scalar("SELECT content FROM comms_messages WHERE client_message_id = $1")
                .bind(message_id)
                .fetch_one(&pool)
                .await
                .expect("stored quote");
        assert!(
            stored.contains(&real_sender),
            "guest quote did not restore member sender {call_id}"
        );
        quotes += 1;
    }
    std::fs::write(
        output.join("guest.json"),
        json!({"call_chats_checked": checked, "member_quotes_checked": quotes}).to_string(),
    )
    .expect("guest count");
}
