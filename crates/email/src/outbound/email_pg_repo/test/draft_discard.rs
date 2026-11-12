//! What a discard means when saves are still on their way.

use super::*;
use crate::domain::models::CreateDraftInput;

/// The owner of the fixture inbox, composing one draft under one client
/// handle, as the composer does.
struct Composer {
    pool: Pool<Postgres>,
    owner: String,
    inbox: Uuid,
    draft: CreateDraftInput,
}

impl Composer {
    async fn new(pool: Pool<Postgres>) -> Composer {
        let inbox = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
        let owner = sqlx::query_scalar("SELECT macro_id FROM email_links WHERE id = $1")
            .bind(inbox)
            .fetch_one(&pool)
            .await
            .unwrap();
        let draft = CreateDraftInput {
            frozen_signature_html: None,
            draft_generation: 0,
            sender_email: None,
            db_id: Some(macro_uuid::generate_uuid_v7()),
            provider_id: None,
            replying_to_id: None,
            provider_thread_id: None,
            thread_db_id: Some(macro_uuid::generate_uuid_v7()),
            subject: "Never mind".to_owned(),
            to: vec![],
            cc: vec![],
            bcc: vec![],
            body_text: Some("Ignore this.".to_owned()),
            body_html: None,
            body_macro: None,
            headers_json: None,
            send_time: None,
            include_signature: Some(false),
            actor: None,
            draft_client_binding: None,
            thread_client_binding: None,
        };
        Composer {
            pool,
            owner,
            inbox,
            draft,
        }
    }

    fn owner(&self) -> MacroUserIdStr<'_> {
        MacroUserIdStr::parse_from_str(&self.owner).unwrap()
    }

    async fn autosaves(&self) -> Result<(), EmailErr> {
        super::thread_unread::service(self.pool.clone())
            .save_draft_for_user_impl(self.owner(), Some(self.inbox), self.draft.clone())
            .await
            .map(|_| ())
    }

    async fn discards(&self) {
        super::thread_unread::service(self.pool.clone())
            .delete_draft_for_user_impl(
                self.owner(),
                self.draft.db_id.unwrap(),
                self.draft.draft_generation,
            )
            .await
            .unwrap();
    }

    async fn drafts(&self) -> Vec<String> {
        sqlx::query_scalar(
            "SELECT subject FROM email_messages WHERE link_id = $1 AND is_draft AND subject = $2",
        )
        .bind(self.inbox)
        .bind(&self.draft.subject)
        .fetch_all(&self.pool)
        .await
        .unwrap()
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_draft"))
)]
async fn a_discarded_draft_stays_discarded_when_a_late_autosave_arrives(pool: Pool<Postgres>) {
    let composer = Composer::new(pool).await;
    composer.autosaves().await.unwrap();
    composer.discards().await;

    // The composer's last autosave left before the discard and arrives
    // after it, as a retried request does on a slow connection.
    let _ = composer.autosaves().await;

    assert!(composer.drafts().await.is_empty());
}
