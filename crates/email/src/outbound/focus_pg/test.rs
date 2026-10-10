use chrono::Duration;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

use super::*;
use crate::domain::focus::{FocusAnswers, FocusThread, FocusVerdict};

const OWNER_LINK: Uuid = uuid::uuid!("00000000-0000-0000-0000-000000000f01");
const OTHER_LINK: Uuid = uuid::uuid!("00000000-0000-0000-0000-000000000f02");
const OTHER_THREAD: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f207");
const INVOICE: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f201");
const ARCHIVED: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f202");
const BULK: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f204");
const FIRST_MESSAGE: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f501");
const LATEST_MESSAGE: Uuid = uuid::uuid!("00000000-0000-0000-0000-00000000f503");

async fn load_thread(
    repo: &FocusPgRepository,
    thread_id: Uuid,
) -> Result<Option<FocusThread>, Report> {
    let Some(inbox) = repo.thread_inbox(thread_id).await? else {
        return Ok(None);
    };
    let mail = repo.thread_mail(&inbox).await?;
    Ok(Some(FocusThread::new(inbox, mail)))
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@acme.com").unwrap()
}

fn record(thread_id: Uuid, message_id: Uuid, at: DateTime<Utc>, importance: u8) -> FocusRecord {
    FocusRecord {
        thread_id,
        link_id: OWNER_LINK,
        classified_message_id: message_id,
        classified_message_ts: at,
        verdict: FocusVerdict {
            is_focus: true,
            category: FocusCategory::Customer,
            needs_reply: true,
            needs_follow_up: false,
            importance,
        },
        answers: FocusAnswers::from_probabilities(&[0.5; 11]).unwrap(),
        model: "jev-test".to_owned(),
        classified_at: Utc::now(),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn reads_a_thread_with_its_relationship(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let thread = load_thread(&repo, INVOICE).await?.expect("thread exists");

    assert_eq!(thread.owner, owner());
    assert_eq!(thread.owner_email, "owner@acme.com");
    assert!(thread.is_signal && thread.inbox_visible);
    assert_eq!(thread.classified_message_id, None);
    // Oldest first; the trashed follow-up is left out.
    let ids = thread.messages.iter().map(|m| m.id).collect::<Vec<_>>();
    assert_eq!(ids.first(), Some(&FIRST_MESSAGE));
    assert_eq!(ids.last(), Some(&LATEST_MESSAGE));
    assert_eq!(ids.len(), 3);
    let first = &thread.messages[0];
    assert_eq!(first.from_email.as_deref(), Some("Casey@Customer.com"));
    assert_eq!(first.from_name.as_deref(), Some("Casey"));
    assert_eq!(first.to, vec!["owner@acme.com"]);
    assert_eq!(first.cc, vec!["jacob@acme.com"]);
    assert!(first.has_attachments && !first.bulk);
    assert_eq!(thread.messages[2].from_name.as_deref(), Some("Casey C."));
    assert!(thread.messages[1].is_sent);
    assert_eq!(
        thread.sent_notes,
        vec![SentNote {
            recipient: "casey@customer.com".to_owned(),
            body: Some("Thanks, I will take a look today.".to_owned()),
        }]
    );
    assert!(load_thread(&repo, Uuid::new_v4()).await?.is_none());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn marks_bulk_mail_and_finds_brush_offs(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let thread = load_thread(&repo, BULK).await?.expect("thread exists");
    assert!(thread.messages[0].bulk);
    assert_eq!(
        thread.sent_notes,
        vec![SentNote {
            recipient: "seller@leads.io".to_owned(),
            body: Some("No thanks".to_owned()),
        }]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn stale_threads_cover_enabled_inbox_signal_mail_in_the_window(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let since = Utc::now() - Duration::days(30);
    let enabled = vec!["acme.com".to_owned()];
    let stale = async |limit| -> Result<Vec<Uuid>, Report> {
        Ok(repo
            .stale_threads(since, &enabled, limit)
            .await?
            .into_iter()
            .map(|stale| stale.thread_id)
            .collect())
    };

    assert_eq!(stale(10).await?, vec![INVOICE, BULK]);
    assert_eq!(stale(1).await?, vec![INVOICE]);
    assert!(repo.stale_threads(since, &[], 10).await?.is_empty());

    // Classified at an older message: still stale. At the latest: done.
    let thread = load_thread(&repo, INVOICE).await?.unwrap();
    repo.save(&record(INVOICE, FIRST_MESSAGE, thread.messages[0].at, 50))
        .await?;
    assert_eq!(stale(10).await?, vec![INVOICE, BULK]);
    let latest = thread.messages.last().unwrap();
    repo.save(&record(INVOICE, latest.id, latest.at, 50))
        .await?;
    assert_eq!(stale(10).await?, vec![BULK]);
    assert_eq!(
        load_thread(&repo, INVOICE)
            .await?
            .unwrap()
            .classified_message_id,
        Some(LATEST_MESSAGE)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn an_older_classification_never_replaces_a_newer_one(
    pool: Pool<Postgres>,
) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let thread = load_thread(&repo, INVOICE).await?.unwrap();
    let latest = thread.messages.last().unwrap();
    assert!(
        repo.save(&record(INVOICE, latest.id, latest.at, 80))
            .await?
    );
    assert!(
        !repo
            .save(&record(INVOICE, FIRST_MESSAGE, thread.messages[0].at, 10))
            .await?
    );

    let stored = repo.focus_for_threads(&owner(), &[INVOICE]).await?;
    let focus = stored.get(&INVOICE).expect("stored");
    assert_eq!(focus.importance, 80);
    assert_eq!(focus.category, FocusCategory::Customer);
    assert!(focus.needs_reply && !focus.needs_follow_up && focus.is_focus);
    assert_eq!(
        load_thread(&repo, INVOICE)
            .await?
            .unwrap()
            .classified_message_id,
        Some(LATEST_MESSAGE)
    );

    // Reclassifying the same message replaces the result.
    assert!(
        repo.save(&record(INVOICE, latest.id, latest.at, 70))
            .await?
    );
    let stored = repo.focus_for_threads(&owner(), &[INVOICE]).await?;
    assert_eq!(stored.get(&INVOICE).expect("stored").importance, 70);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("email_focus"))
)]
async fn focus_list_is_the_owners_inbox_by_importance(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let now = Utc::now();
    repo.save(&record(INVOICE, LATEST_MESSAGE, now, 60)).await?;
    repo.save(&record(BULK, Uuid::new_v4(), now, 90)).await?;
    // Archived threads leave Focus even with a stored verdict.
    repo.save(&record(ARCHIVED, Uuid::new_v4(), now, 99))
        .await?;
    // Someone else's inbox, not linked to the owner.
    repo.save(&FocusRecord {
        link_id: OTHER_LINK,
        ..record(OTHER_THREAD, Uuid::new_v4(), now, 95)
    })
    .await?;

    let since = now - Duration::days(30);
    assert_eq!(
        repo.focus_thread_ids(&owner(), since, 10).await?,
        vec![BULK, INVOICE]
    );
    assert_eq!(repo.focus_thread_ids(&owner(), since, 1).await?, vec![BULK]);
    assert_eq!(
        repo.focus_thread_ids(&owner(), now - Duration::days(1), 10)
            .await?,
        vec![INVOICE]
    );

    // The other inbox's owner sees only their own thread.
    let stranger = MacroUserIdStr::try_from_email("other@elsewhere.com").unwrap();
    assert_eq!(
        repo.focus_thread_ids(&stranger, since, 10).await?,
        vec![OTHER_THREAD]
    );
    assert!(
        repo.focus_for_threads(&stranger, &[INVOICE, BULK])
            .await?
            .is_empty()
    );
    assert_eq!(
        repo.focus_for_threads(&owner(), &[INVOICE, BULK, ARCHIVED])
            .await?
            .len(),
        3
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("email_focus", "email_focus_linked")
    )
)]
async fn focus_covers_inboxes_linked_to_the_owner(pool: Pool<Postgres>) -> Result<(), Report> {
    let repo = FocusPgRepository(pool);
    let now = Utc::now();
    repo.save(&FocusRecord {
        link_id: OTHER_LINK,
        ..record(OTHER_THREAD, Uuid::new_v4(), now, 70)
    })
    .await?;

    // The other inbox is linked to the owner's account, so its Focus is theirs too.
    assert_eq!(
        repo.focus_thread_ids(&owner(), now - Duration::days(30), 10)
            .await?,
        vec![OTHER_THREAD]
    );
    assert!(
        repo.focus_for_threads(&owner(), &[OTHER_THREAD])
            .await?
            .contains_key(&OTHER_THREAD)
    );
    Ok(())
}
