use super::*;
use crate::domain::models::{PreviewCursorQuery, PreviewView, PreviewViewStandardLabel};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Query, SimpleSortMethod};

async fn sent_threads(repo: &EmailPgRepo, link: Uuid) -> Vec<Uuid> {
    repo.previews_for_view_cursor(
        PreviewCursorQuery {
            view: PreviewView::StandardLabel(PreviewViewStandardLabel::Sent),
            link_ids: vec![link],
            limit: 50,
            query: Query::new(None, SimpleSortMethod::UpdatedAt, None),
            team_id: None,
        },
        MacroUserIdStr::parse_from_str(ACTOR).unwrap().to_owned(),
    )
    .await
    .unwrap()
    .into_iter()
    .map(|preview| preview.id)
    .collect()
}

async fn latest_outbound(db: &PgPool, thread: Uuid) -> Option<chrono::DateTime<chrono::Utc>> {
    sqlx::query_scalar!(
        "SELECT latest_outbound_message_ts FROM email_threads WHERE id = $1",
        thread
    )
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_confirmed_outlook_send_is_in_sent_before_the_provider_copy_syncs(db: PgPool) {
    let (sync, repo, input, link) = setup(&db, true).await;
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let mut cp = checkpoint(&lease, DraftStage::Confirming);
    cp.draft.as_mut().unwrap().is_draft = false;
    sync.confirm_sent(&lease, &cp).await.unwrap();
    assert_eq!(sent_threads(&repo, link).await, vec![input.thread_db_id]);

    let work = sync.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    let mut remote = snapshot(link, "a", MailboxState::default(), "v2");
    remote.content.message.is_sent = true;
    sync.ingest(&work, remote).await.unwrap();
    assert_eq!(
        latest_outbound(&db, input.thread_db_id)
            .await
            .map(|ts| ts.to_rfc3339())
            .as_deref(),
        Some("2026-10-01T12:00:00+00:00"),
        "the provider's sent time replaces the provisional one"
    );
    assert_eq!(sent_threads(&repo, link).await, vec![input.thread_db_id]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_old_outlook_draft_sorts_in_sent_by_when_it_was_sent(db: PgPool) {
    let (sync, _, input, _) = setup(&db, true).await;
    sqlx::query!(
        "UPDATE email_messages SET internal_date_ts = '2026-09-01T09:00:00Z' WHERE id = $1",
        input.db_id
    )
    .execute(&db)
    .await
    .unwrap();
    let lease = sync
        .claim_draft(
            Uuid::now_v7(),
            crate::domain::mailbox::drafts::models::DraftClaimMode::All,
        )
        .await
        .unwrap()
        .unwrap();
    let mut cp = checkpoint(&lease, DraftStage::Confirming);
    cp.draft.as_mut().unwrap().is_draft = false;
    let before = chrono::Utc::now() - chrono::Duration::seconds(5);
    sync.confirm_sent(&lease, &cp).await.unwrap();
    let outbound = latest_outbound(&db, input.thread_db_id).await.unwrap();
    assert!(
        outbound >= before,
        "sent thread sorts by its send time, not the draft's {outbound}"
    );
}
