//! Which due folder stream a claim takes: every other turn of a sync loop
//! takes the longest-due import round first, the others the longest-due
//! folder of either kind, and a new import's Inbox and Sent rounds go ahead of
//! its other folders.

use super::retries::{Provider, sync};
use crate::domain::mailbox::claim::StreamClaim;
use crate::domain::mailbox::live_pass::LiveImportPass;
use crate::domain::mailbox::{MailboxSyncRepository, StreamLease};
use crate::outbound::mailbox_pg::PgMailboxSync;
use email_api_client::domain::models::{FolderRole, MailFolder, ProviderId};
use email_api_client::domain::models::{MailboxChangePage, StreamPosition, StreamToken};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

/// A mailbox with one folder stream, due `due_seconds_ago`; `finished` once
/// the folder's import round is done.
async fn mailbox(db: &PgPool, address: &str, finished: bool, due_seconds_ago: f64) -> Uuid {
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,'macro|' || $2,'outlook-owner',$2,'OUTLOOK',1)
    "#,link,address).execute(db).await.unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,next_run_at)
        VALUES ($1,$2,1,'mail_folder','folder',$3,now() - make_interval(secs => $4))
    "#,
        macro_uuid::generate_uuid_v7(),
        link,
        finished,
        due_seconds_ago
    )
    .execute(db)
    .await
    .unwrap();
    link
}

async fn claim(repo: &PgMailboxSync, claim: StreamClaim) -> StreamLease {
    repo.claim_stream(macro_uuid::generate_uuid_v7(), claim)
        .await
        .unwrap()
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_import_first_claim_takes_rounds_ahead_of_polls_due_long_before_them(db: PgPool) {
    let polled = mailbox(&db, "polled@example.com", true, 1800.0).await;
    let first = mailbox(&db, "first@example.com", false, 10.0).await;
    let second = mailbox(&db, "second@example.com", false, 5.0).await;
    let repo = PgMailboxSync::new(db.clone());

    let order = [
        claim(&repo, StreamClaim::ImportFirst).await.mailbox.link_id,
        claim(&repo, StreamClaim::ImportFirst).await.mailbox.link_id,
        claim(&repo, StreamClaim::ImportFirst).await.mailbox.link_id,
    ];
    assert_eq!(
        order,
        [first, second, polled],
        "the poll once no round is due"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_longest_due_claim_takes_whichever_folder_came_due_first(db: PgPool) {
    let early_round = mailbox(&db, "early@example.com", false, 300.0).await;
    let polled = mailbox(&db, "polled@example.com", true, 120.0).await;
    let late_round = mailbox(&db, "late@example.com", false, 10.0).await;
    let repo = PgMailboxSync::new(db.clone());

    let order = [
        claim(&repo, StreamClaim::LongestDue).await.mailbox.link_id,
        claim(&repo, StreamClaim::LongestDue).await.mailbox.link_id,
        claim(&repo, StreamClaim::LongestDue).await.mailbox.link_id,
    ];
    assert_eq!(order, [early_round, polled, late_round]);
}

/// A page that leaves its round due again at once, as an import's pages do
/// until its last.
fn next_page() -> MailboxChangePage {
    MailboxChangePage {
        changed: Vec::new(),
        removed: Vec::new(),
        position: StreamPosition::Continue(StreamToken::new("next".into())),
        reader_revision: 1,
    }
}

/// A finished folder's page: its next poll is minutes away.
fn checkpoint() -> MailboxChangePage {
    MailboxChangePage {
        changed: Vec::new(),
        removed: Vec::new(),
        position: StreamPosition::Checkpoint(StreamToken::new("checkpoint".into())),
        reader_revision: 1,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sync_loop_reads_an_import_round_first_every_other_turn(db: PgPool) {
    // The round has always just come due; both polls are long overdue.
    let importing = mailbox(&db, "importing@example.com", false, 0.0).await;
    let oldest = mailbox(&db, "oldest@example.com", true, 1800.0).await;
    let older = mailbox(&db, "older@example.com", true, 1200.0).await;
    let repo = PgMailboxSync::new(db.clone());
    let service = sync(
        &repo,
        Provider::paging(vec![next_page(), checkpoint(), next_page(), checkpoint()]),
    );

    let mut read = Vec::new();
    for _ in 0..4 {
        assert!(service.enumerate_once().await.unwrap());
        read.push(
            sqlx::query_scalar!(
                "SELECT link_id FROM email_sync_streams ORDER BY lease_started_at DESC NULLS LAST LIMIT 1"
            )
            .fetch_one(&db)
            .await
            .unwrap(),
        );
    }

    assert_eq!(read, [importing, oldest, importing, older]);
}

/// The `mail_folder` stream of `link`.
async fn folder_stream(db: &PgPool, link: Uuid) -> Uuid {
    sqlx::query_scalar!(
        "SELECT id FROM email_sync_streams WHERE link_id = $1 AND kind = 'mail_folder'",
        link
    )
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_live_pass_claim_leaves_the_import_first_turn_to_the_next_folder_claim(db: PgPool) {
    let importing = mailbox(&db, "importing@example.com", false, 0.0).await;
    let polled = mailbox(&db, "polled@example.com", true, 1800.0).await;
    // The importing folder's live pass, due longest of all.
    let live = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,next_run_at,import_started_at)
        VALUES ($1,$2,1,'mail_folder_live','folder',true,now() - interval '1 hour',now() - interval '1 hour')
    "#,
        live,
        importing
    )
    .execute(&db)
    .await
    .unwrap();
    let round = folder_stream(&db, importing).await;
    let poll = folder_stream(&db, polled).await;
    let repo = PgMailboxSync::new(db.clone());
    let switch = LiveImportPass::default();
    switch.set(true);
    let service = sync(
        &repo,
        Provider::paging(vec![checkpoint(), next_page(), checkpoint()]),
    )
    .with_live_import_pass(switch);

    let mut read = Vec::new();
    for _ in 0..3 {
        assert!(service.enumerate_once().await.unwrap());
        read.push(
            sqlx::query_scalar!(
                "SELECT id FROM email_sync_streams ORDER BY lease_started_at DESC NULLS LAST LIMIT 1"
            )
            .fetch_one(&db)
            .await
            .unwrap(),
        );
    }

    assert_eq!(read, [live, round, poll]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_import_reads_its_inbox_then_sent_before_folders_listed_ahead_of_them(db: PgPool) {
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,'macro|new@example.com','outlook-owner','new@example.com','OUTLOOK',1)
    "#,link).execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id) VALUES ($1,$2,1,'folder_catalog','mail')",
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let repo = PgMailboxSync::new(db.clone());
    let discovery = repo
        .claim_catalog(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    // Graph lists folders alphabetically.
    let folder = |id: &str, role: FolderRole| MailFolder {
        id: ProviderId::new(id).unwrap(),
        parent_id: None,
        name: id.into(),
        role,
        has_children: false,
        total_items: Some(100),
    };
    repo.commit_catalog(
        &discovery,
        &[
            folder("archive", FolderRole::Archive),
            folder("conversation history", FolderRole::Other),
            folder("deleted", FolderRole::Trash),
            folder("inbox", FolderRole::Inbox),
            folder("junk", FolderRole::Junk),
            folder("projects", FolderRole::Other),
            folder("sent", FolderRole::Sent),
        ],
    )
    .await
    .unwrap();

    let mut order = Vec::new();
    for _ in 0..7 {
        order.push(
            claim(&repo, StreamClaim::ImportFirst)
                .await
                .folder
                .as_str()
                .to_owned(),
        );
    }
    assert_eq!(order[..2], ["inbox", "sent"], "{order:?}");
    // The rest are due together; ids made in the same millisecond order them.
    let mut rest = order[2..].to_vec();
    rest.sort();
    assert_eq!(
        rest,
        [
            "archive",
            "conversation history",
            "deleted",
            "junk",
            "projects"
        ]
    );
}
