//! Mail deleted at Outlook leaves the CRM cleanup its correspondents, as a
//! Gmail deletion does.

use super::{fixture, snapshot};
use crate::domain::mailbox::live_pass::StreamKind;
use crate::domain::mailbox::*;
use email_api_client::domain::models::{
    MailboxChangePage, MailboxState, ProviderId, StreamPosition, StreamToken,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::email::service::address::ContactInfo;
use sqlx::PgPool;
use uuid::Uuid;

fn contact(email: &str) -> ContactInfo {
    ContactInfo {
        email: email.into(),
        name: None,
        photo_url: None,
    }
}

async fn candidates(db: &PgPool, link: Uuid) -> Vec<String> {
    sqlx::query_scalar!(
        "SELECT contact_email FROM crm_cleanup_candidates WHERE link_id = $1 ORDER BY contact_email",
        link
    )
    .fetch_all(db)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mail_deleted_at_outlook_leaves_its_correspondents_to_the_crm_cleanup(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let stream = repo
        .claim_stream(Uuid::now_v7(), StreamKind::MailFolder)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    repo.commit_page(
        &stream,
        &MailboxChangePage {
            changed: vec![
                ProviderId::new("received").unwrap(),
                ProviderId::new("sent").unwrap(),
                ProviderId::new("draft").unwrap(),
            ],
            removed: vec![],
            position: StreamPosition::Checkpoint(StreamToken::new("delta".into())),
            reader_revision: 1,
        },
    )
    .await
    .unwrap();
    let mut work = Vec::new();
    while let Some(lease) = repo
        .claim_message(Uuid::now_v7())
        .await
        .unwrap()
        .into_lease()
    {
        let mut message = snapshot(
            link,
            lease.provider_id.as_str(),
            MailboxState {
                is_draft: lease.provider_id.as_str() == "draft",
                ..Default::default()
            },
            "v1",
        );
        let content = &mut message.content.message;
        match lease.provider_id.as_str() {
            "received" => content.from = Some(contact(" Carol@Acme.example ")),
            "sent" => {
                content.is_sent = true;
                content.from = Some(contact("outlook-test@example.com"));
                content.to = vec![
                    contact("dave@acme.example"),
                    contact("Outlook-Test@example.com"),
                ];
                content.cc = vec![contact("erin@acme.example")];
            }
            _ => content.to = vec![contact("frank@acme.example")],
        }
        repo.ingest(&lease, message).await.unwrap();
        work.push(lease);
    }
    assert_eq!(work.len(), 3);

    for lease in &work {
        repo.absent(lease).await.unwrap();
    }
    assert_eq!(
        candidates(&db, link).await,
        [
            "carol@acme.example",
            "dave@acme.example",
            "erin@acme.example"
        ],
        "the sender of received mail and the recipients of sent mail, without the \
         mailbox's own address or a draft's recipients"
    );

    // Mail already marked missing left earlier; a repeated report adds nothing
    // and doesn't restart the cleanup's settling clock.
    sqlx::query!(
        "DELETE FROM crm_cleanup_candidates WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    for lease in &work {
        repo.absent(lease).await.unwrap();
    }
    assert!(candidates(&db, link).await.is_empty());
}
