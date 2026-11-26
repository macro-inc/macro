use crate::domain::backfill::audit::DirectionClass;
use crate::domain::backfill::{BackfillPass, BackfillRequest, BackfillSettings, DirectoryBackfill};
use crate::domain::models::backfill::OrphanKind;
use crate::outbound::repository::DbContactsRepository;
use chrono::{TimeZone, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::time::Duration;

/// Small pages, so every read pages at least once.
fn backfill(pool: &PgPool) -> DirectoryBackfill<DbContactsRepository, DbContactsRepository> {
    DirectoryBackfill {
        source: DbContactsRepository::new(pool.clone()),
        lists: DbContactsRepository::new(pool.clone()),
        settings: BackfillSettings {
            page_size: 2,
            edge_page_size: 3,
            contact_page_size: 2,
            pause: Duration::ZERO,
            support_roster: HashSet::from([
                MacroUserIdStr::try_from_email("support@macro.com").unwrap()
            ]),
        },
    }
}

fn request(after: Option<chrono::DateTime<Utc>>) -> BackfillRequest {
    BackfillRequest {
        passes: BTreeSet::from([
            BackfillPass::Channels,
            BackfillPass::DirectMessages,
            BackfillPass::Inbox,
        ]),
        dry_run: false,
        after,
    }
}

async fn list_rows(pool: &PgPool) -> Vec<(String, String)> {
    sqlx::query!(
        "SELECT user_id, contact_user_id FROM contact_list_members
         WHERE list_key = 'interacted' ORDER BY user_id, contact_user_id"
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.user_id, row.contact_user_id))
    .collect()
}

async fn inbox_rows(pool: &PgPool) -> Vec<(String, String, String)> {
    sqlx::query!(
        "SELECT user_id, contact_user_id, list_key FROM contact_inbox_members
         ORDER BY user_id, contact_user_id"
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.user_id, row.contact_user_id, row.list_key))
    .collect()
}

fn pairs(rows: &[(&str, &str)]) -> Vec<(String, String)> {
    rows.iter()
        .map(|(a, b)| (a.to_string(), b.to_string()))
        .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn audit_classifies_every_legacy_direction(pool: PgPool) {
    let report = backfill(&pool).audit().await.unwrap();

    assert_eq!((report.legacy.edges, report.legacy.directions), (10, 20));
    assert_eq!(
        report.legacy.classes,
        BTreeMap::from([
            (DirectionClass::Teammate, 2),
            (DirectionClass::SharedChannel, 4),
            (DirectionClass::DmWithMessage, 2),
            (DirectionClass::Inbox, 2),
            (DirectionClass::Invited, 1),
            (DirectionClass::ReverseImport, 2),
            (DirectionClass::EmptyDm, 2),
            (DirectionClass::SupportChannel, 2),
            (DirectionClass::Referral, 1),
            (DirectionClass::DisconnectedInbox, 1),
            (DirectionClass::NoSurvivingRecord, 1),
        ])
    );
    assert_eq!(
        (report.legacy.explained, report.legacy.unexplained),
        (11, 9)
    );

    let channels = &report.channels;
    assert_eq!(
        (
            channels.shared,
            channels.support,
            channels.direct_messages,
            channels.direct_messages_with_message
        ),
        (1, 1, 2, 1)
    );
    // Public channel: a and c (2 rows); snapshot adds gone with a and c (4).
    assert_eq!(
        (report.interacted.channel_rows, report.interacted.dm_rows),
        (6, 2)
    );
    assert!(
        list_rows(&pool).await.is_empty(),
        "the audit writes nothing"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn backfill_writes_interacted_and_inbox_rows_and_repeats_as_a_no_op(pool: PgPool) {
    let backfill = backfill(&pool);

    let report = backfill.backfill(&request(None)).await.unwrap();

    assert_eq!(
        list_rows(&pool).await,
        pairs(&[
            ("macro|a@example.com", "macro|c@example.com"),
            ("macro|a@example.com", "macro|d@example.com"),
            ("macro|a@example.com", "macro|gone@example.com"),
            ("macro|c@example.com", "macro|a@example.com"),
            ("macro|c@example.com", "macro|gone@example.com"),
            ("macro|d@example.com", "macro|a@example.com"),
            ("macro|gone@example.com", "macro|a@example.com"),
            ("macro|gone@example.com", "macro|c@example.com"),
        ])
    );
    // The reverse of an import is not copied: x and d never see a, f's
    // address book adds a to f only.
    assert_eq!(
        inbox_rows(&pool).await,
        vec![
            (
                "macro|a@example.com".to_owned(),
                "macro|d@example.com".to_owned(),
                "gmail".to_owned()
            ),
            (
                "macro|a@example.com".to_owned(),
                "macro|x@example.org".to_owned(),
                "gmail".to_owned()
            ),
            (
                "macro|f@example.com".to_owned(),
                "macro|a@example.com".to_owned(),
                "outlook".to_owned()
            ),
        ]
    );
    assert_eq!(report.interacted_from_channels.unwrap().added_rows, 6);
    assert_eq!(
        report.interacted_from_direct_messages.unwrap().added_rows,
        2
    );
    let inbox = report.inbox.unwrap();
    assert_eq!((inbox.owners, inbox.written.added_rows), (2, 3));

    let repeat = backfill.backfill(&request(None)).await.unwrap();
    assert_eq!(repeat.interacted_from_channels.unwrap().added_rows, 0);
    assert_eq!(
        repeat.interacted_from_direct_messages.unwrap().added_rows,
        0
    );
    assert_eq!(repeat.inbox.unwrap().written.added_rows, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn after_rederives_only_recent_joins_and_messages(pool: PgPool) {
    let after = Utc.with_ymd_and_hms(2026, 5, 1, 0, 0, 0).unwrap();
    sqlx::query!(
        "UPDATE comms_channel_participants SET joined_at = $1::timestamptz - interval '1 day'
         WHERE channel_id = '00000000-0000-4000-c000-000000000001'",
        after
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at)
         VALUES ('00000000-0000-4000-c000-000000000001', 'macro|r@example.com', 'member', $1)",
        after
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE comms_messages SET created_at = $1::timestamptz - interval '1 day'",
        after
    )
    .execute(&pool)
    .await
    .unwrap();

    let mut request = request(Some(after));
    request.passes = BTreeSet::from([BackfillPass::Channels, BackfillPass::DirectMessages]);
    let report = backfill(&pool).backfill(&request).await.unwrap();

    // r joined after the bound and pairs with everyone present; the April
    // snapshot and the older DM message are not re-read.
    assert_eq!(
        list_rows(&pool).await,
        pairs(&[
            ("macro|a@example.com", "macro|r@example.com"),
            ("macro|c@example.com", "macro|r@example.com"),
            ("macro|r@example.com", "macro|a@example.com"),
            ("macro|r@example.com", "macro|c@example.com"),
        ])
    );
    assert_eq!(report.interacted_from_direct_messages.unwrap().writes, 0);
    assert!(report.inbox.is_none());
}

async fn all_list_rows(pool: &PgPool) -> Vec<(String, String, String)> {
    sqlx::query!(
        "SELECT user_id, contact_user_id, list_key FROM contact_list_members
         ORDER BY user_id, contact_user_id, list_key"
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.user_id, row.contact_user_id, row.list_key))
    .collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("orphans"))
)]
async fn the_orphan_pass_removes_rows_deleted_accounts_left(pool: PgPool) {
    let backfill = backfill(&pool);
    let audit = backfill.audit().await.unwrap();
    let mut request = request(None);
    request.passes = BTreeSet::from([BackfillPass::Orphans]);
    request.dry_run = true;
    let dry_run = backfill.backfill(&request).await.unwrap();

    // Counted, not deleted, by the audit and the dry run.
    for sweeps in [&audit.orphans, dry_run.orphans.as_ref().unwrap()] {
        let counts: Vec<_> = sweeps
            .iter()
            .map(|(kind, sweep)| (*kind, sweep.orphans, sweep.rows, sweep.deleted_rows))
            .collect();
        assert_eq!(
            counts,
            vec![
                (OrphanKind::ListOwner, 1, 2, 0),
                (OrphanKind::InboxOwner, 1, 2, 0),
                (OrphanKind::InteractedContact, 1, 1, 0),
            ]
        );
    }
    assert_eq!(all_list_rows(&pool).await.len(), 9);

    request.dry_run = false;
    let report = backfill.backfill(&request).await.unwrap();

    let deleted: u64 = report
        .orphans
        .unwrap()
        .values()
        .map(|s| s.deleted_rows)
        .sum();
    assert_eq!(deleted, 5);
    // The invited row naming ghost and the one naming an outsider stay;
    // a legacy-cased account keeps its rows.
    let row = |user: &str, contact: &str, list: &str| {
        (user.to_owned(), contact.to_owned(), list.to_owned())
    };
    assert_eq!(
        all_list_rows(&pool).await,
        vec![
            row("macro|a@example.com", "macro|b@example.com", "interacted"),
            row("macro|a@example.com", "macro|ghost@example.com", "invited"),
            row(
                "macro|a@example.com",
                "macro|mixed@example.com",
                "interacted"
            ),
            row(
                "macro|a@example.com",
                "macro|outsider@example.org",
                "invited"
            ),
            row("macro|b@example.com", "macro|a@example.com", "interacted"),
            row(
                "macro|mixed@example.com",
                "macro|a@example.com",
                "interacted"
            ),
        ]
    );
    assert!(inbox_rows(&pool).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("directory"))
)]
async fn an_imap_owner_does_not_stop_a_later_gmail_owner_from_being_backfilled(pool: PgPool) {
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            provider = 'IMAP'
        WHERE
            macro_id = $1
        "#,
        "macro|a@example.com",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        UPDATE
            email_links
        SET
            provider = 'GMAIL'
        WHERE
            macro_id = $1
        "#,
        "macro|f@example.com",
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut backfill = backfill(&pool);
    // Put the later Gmail owner on a separate page, beyond the IMAP owner.
    backfill.settings.page_size = 1;
    let mut request = request(None);
    request.passes = BTreeSet::from([BackfillPass::Inbox]);
    let report = backfill.backfill(&request).await.unwrap().inbox.unwrap();
    assert_eq!((report.owners, report.written.added_rows), (2, 3));
    assert_eq!(
        inbox_rows(&pool).await,
        [
            (
                "macro|a@example.com".to_owned(),
                "macro|d@example.com".to_owned(),
                "imap".to_owned()
            ),
            (
                "macro|a@example.com".to_owned(),
                "macro|x@example.org".to_owned(),
                "imap".to_owned()
            ),
            (
                "macro|f@example.com".to_owned(),
                "macro|a@example.com".to_owned(),
                "gmail".to_owned()
            ),
        ]
    );
}
