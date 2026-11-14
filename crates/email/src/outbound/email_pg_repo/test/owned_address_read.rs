//! Parity of the owned All Mail address read (`dynamic/query/owned_scope.rs`)
//! with the general builder: each way the read can take a page returns the
//! general builder's rows, in its order, page after page, for every filter
//! shape the Sales Email view and a CRM record under Me send.
//!
//! Fixture: `email/fixtures/email_owned_address_read.sql` (generated, see
//! its header).

use super::*;
use crate::outbound::email_pg_repo::db_types::ThreadPreviewCursorDbRow;
use crate::outbound::email_pg_repo::dynamic::{OwnedReadTuning, OwnedStreams};
use item_filters::SharedEmailFilter;
use item_filters::ast::email::{AttachmentKind, SubjectQuery};
use macro_user_id::cowlike::CowLike;

const CALLER: &str = "macro|u0@owned.test";

fn link(i: u8) -> Uuid {
    Uuid::from_u128(0xf100_0000_0000_0000_0000_0000_0000_0000 | u128::from(i))
}

/// Every way the owned read takes a page, by name.
const READS: [(&str, OwnedReadTuning); 5] = [
    ("default", OwnedReadTuning::DEFAULT),
    (
        "superset",
        OwnedReadTuning {
            superset_limit: i64::MAX,
            window_per_row: 20,
        },
    ),
    (
        "inboxes",
        OwnedReadTuning {
            superset_limit: -1,
            window_per_row: 1_000,
        },
    ),
    (
        "inboxes_tight",
        OwnedReadTuning {
            superset_limit: -1,
            window_per_row: 3,
        },
    ),
    (
        "inboxes_then_superset",
        OwnedReadTuning {
            superset_limit: -1,
            window_per_row: 1,
        },
    ),
];

fn any_direction(email: Email) -> Expr<EmailLiteral> {
    Expr::or(
        Expr::or(
            Expr::Literal(EmailLiteral::Sender(email.clone())),
            Expr::Literal(EmailLiteral::Cc(email.clone())),
        ),
        Expr::or(
            Expr::Literal(EmailLiteral::Bcc(email.clone())),
            Expr::Literal(EmailLiteral::Recipient(email)),
        ),
    )
}

fn complete(address: &str) -> Email {
    Email::Complete(EmailStr::parse_from_str(address).unwrap().into_owned())
}

/// A company's tree: every direction of every domain.
fn company(domains: &[&str]) -> Expr<EmailLiteral> {
    domains
        .iter()
        .map(|domain| any_direction(Email::Domain(domain.to_string())))
        .reduce(Expr::or)
        .unwrap()
}

/// A contact's tree: every direction of every address.
fn contact(addresses: &[&str]) -> Expr<EmailLiteral> {
    addresses
        .iter()
        .map(|address| any_direction(complete(address)))
        .reduce(Expr::or)
        .unwrap()
}

/// The Sales Email view's tree: every company's domains and every contact's
/// addresses, in every direction.
fn sales(domains: &[&str], addresses: &[&str]) -> Expr<EmailLiteral> {
    Expr::or(company(domains), contact(addresses))
}

fn and(tree: Expr<EmailLiteral>, literal: EmailLiteral) -> Expr<EmailLiteral> {
    Expr::and(tree, Expr::Literal(literal))
}

/// A caller's pages until one comes back empty, and the owned read's
/// streams for each page (`None` when the general builder read it).
struct Pages {
    rows: Vec<Vec<ThreadPreviewCursorDbRow>>,
    streams: Vec<Option<OwnedStreams>>,
}

impl Pages {
    /// Each row in full, to compare.
    fn printed(&self) -> Vec<Vec<String>> {
        self.rows
            .iter()
            .map(|page| page.iter().map(|row| format!("{row:?}")).collect())
            .collect()
    }
}

async fn pages(
    pool: &Pool<Postgres>,
    caller_links: &[Uuid],
    filter: &Expr<EmailLiteral>,
    limit: u32,
    read: Option<OwnedReadTuning>,
) -> anyhow::Result<Pages> {
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let filter = Arc::new(filter.clone());
    let mut pages = Pages {
        rows: Vec::new(),
        streams: Vec::new(),
    };
    let mut cursor = None;
    loop {
        let query = Query::new(cursor.take(), SimpleSortMethod::UpdatedAt, filter.clone());
        let (page, streams) = dynamic::dynamic_email_thread_cursor_with(
            pool,
            caller_links,
            limit,
            &view,
            query,
            CALLER,
            None,
            read,
        )
        .await?;
        cursor = page.last().map(|last| Cursor {
            id: last.id,
            limit: limit as usize,
            val: CursorVal {
                sort_type: SimpleSortMethod::UpdatedAt,
                last_val: last.sort_ts,
            },
            filter: filter.clone(),
        });
        pages.rows.push(page);
        pages.streams.push(streams);
        if cursor.is_none() {
            return Ok(pages);
        }
        anyhow::ensure!(pages.rows.len() <= 3_000, "runaway pagination");
    }
}

/// Asserts each owned read takes every page and returns the general
/// builder's pages, and returns how many rows those pages hold.
async fn assert_parity(
    pool: &Pool<Postgres>,
    caller_links: &[Uuid],
    filter: &Expr<EmailLiteral>,
    limit: u32,
) -> anyhow::Result<usize> {
    let expected = pages(pool, caller_links, filter, limit, None).await?;
    assert!(expected.streams.iter().all(Option::is_none));
    for (name, tuning) in READS {
        let actual = pages(pool, caller_links, filter, limit, Some(tuning)).await?;
        assert!(
            actual.streams.iter().all(Option::is_some),
            "{name} read left pages to the general builder for {filter:?}: {:?}",
            actual.streams
        );
        assert_eq!(
            actual.printed(),
            expected.printed(),
            "{name} read differs for {caller_links:?} with {filter:?} in pages of {limit}"
        );
    }
    Ok(expected.rows.iter().map(Vec::len).sum())
}

/// Asserts the general builder reads every page of a request the owned read
/// doesn't take, and returns how many rows the pages hold.
async fn assert_general(
    pool: &Pool<Postgres>,
    caller_links: &[Uuid],
    filter: &Expr<EmailLiteral>,
    limit: u32,
) -> anyhow::Result<usize> {
    let expected = pages(pool, caller_links, filter, limit, None).await?;
    let actual = pages(
        pool,
        caller_links,
        filter,
        limit,
        Some(OwnedReadTuning::DEFAULT),
    )
    .await?;
    assert!(actual.streams.iter().all(Option::is_none), "{filter:?}");
    assert_eq!(actual.printed(), expected.printed());
    Ok(expected.rows.iter().map(Vec::len).sum())
}

/// The ids of the threads the general builder lists.
async fn listed(
    pool: &Pool<Postgres>,
    caller_links: &[Uuid],
    filter: &Expr<EmailLiteral>,
) -> anyhow::Result<Vec<Uuid>> {
    Ok(pages(pool, caller_links, filter, 100, None)
        .await?
        .rows
        .concat()
        .iter()
        .map(|row| row.id)
        .collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn company_pages_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let dense = company(&["dense.test"]);
    for limit in [1, 7, 100] {
        let rows = assert_parity(&pool, &[link(0)], &dense, limit).await?;
        assert!(rows > 150, "the company covers much of the mail: {rows}");
    }
    // Both of the caller's inboxes.
    let rows = assert_parity(&pool, &[link(0), link(1)], &dense, 25).await?;
    assert!(rows > 200, "{rows}");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn rare_and_old_companies_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let sparse = company(&["sparse.test"]);
    let rows = assert_parity(&pool, &[link(0)], &sparse, 1).await?;
    assert!(rows > 5, "sparse.test has a few threads: {rows}");
    // Only the oldest mail: the inbox stream's window holds none of it.
    let old = company(&["Old.test"]);
    let rows = assert_parity(&pool, &[link(0), link(1)], &old, 10).await?;
    assert!(rows > 20, "old.test has the oldest threads: {rows}");
    let both = company(&["sparse.test", "old.test", "unknown.test"]);
    assert_parity(&pool, &[link(0), link(1)], &both, 25).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn copied_only_companies_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    for domain in ["cc.test", "bcc.test"] {
        let rows = assert_parity(&pool, &[link(0), link(1)], &company(&[domain]), 9).await?;
        assert!(rows > 10, "{domain} is on some mail: {rows}");
    }
    // One direction only.
    let cc_only = Expr::Literal(EmailLiteral::Cc(Email::Domain("cc.test".to_owned())));
    let rows = assert_parity(&pool, &[link(0)], &cc_only, 9).await?;
    assert!(rows > 10, "{rows}");
    let from_dense = Expr::Literal(EmailLiteral::Sender(Email::Domain("dense.test".to_owned())));
    let rows = assert_parity(&pool, &[link(0)], &from_dense, 30).await?;
    assert!(rows > 100, "{rows}");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn contact_pages_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let one = contact(&["p1@dense.test"]);
    let rows = assert_parity(&pool, &[link(0)], &one, 9).await?;
    assert!(rows > 50, "the contact is on many threads: {rows}");
    // An address the caller's inboxes don't know, and one no inbox knows.
    let several = contact(&[
        "p0@sparse.test",
        "P2@Old.test",
        "only.u1@solo.test",
        "nobody@dense.test",
    ]);
    let rows = assert_parity(&pool, &[link(0), link(1)], &several, 4).await?;
    assert!(rows > 10, "{rows}");
    // No address resolves, so the request ends before either read.
    let unknown = contact(&["only.u1@solo.test", "nobody@dense.test"]);
    let rows = assert_general(&pool, &[link(0), link(1)], &unknown, 4).await?;
    assert_eq!(rows, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn sales_view_pages_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let tree = sales(
        &["dense.test", "sparse.test", "old.test"],
        &["p0@other3.test", "p1@other4.test", "only.u1@solo.test"],
    );
    for limit in [1, 7, 100] {
        let rows = assert_parity(&pool, &[link(0), link(1)], &tree, limit).await?;
        assert!(rows > 250, "{rows}");
    }
    let rare = sales(&["sparse.test"], &["p0@other3.test"]);
    assert_parity(&pool, &[link(0), link(1)], &rare, 3).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn partial_addresses_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    for text in ["1@dens", "SPARSE", "@other1", "no-such-text"] {
        let tree = any_direction(Email::Partial(text.to_owned()));
        assert_parity(&pool, &[link(0), link(1)], &tree, 11).await?;
    }
    let mixed = Expr::or(
        company(&["sparse.test"]),
        any_direction(Email::Partial("p2@dens".to_owned())),
    );
    let rows = assert_parity(&pool, &[link(0)], &mixed, 11).await?;
    assert!(rows > 50, "{rows}");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn facets_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let dense = company(&["dense.test"]);
    for literal in [
        EmailLiteral::Importance(true),
        EmailLiteral::Importance(false),
        EmailLiteral::Read(true),
        EmailLiteral::Read(false),
        EmailLiteral::InboxVisible(false),
        EmailLiteral::Attachment(AttachmentKind::Pdf),
    ] {
        let rows =
            assert_parity(&pool, &[link(0), link(1)], &and(dense.clone(), literal), 8).await?;
        assert!(rows > 5, "{rows}");
    }
    let signal_unread = and(
        and(dense.clone(), EmailLiteral::Importance(true)),
        EmailLiteral::Read(false),
    );
    assert_parity(&pool, &[link(0)], &signal_unread, 5).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn owner_terms_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let dense = company(&["dense.test"]);
    let both = [link(0), link(1)];
    for owner in [link(0), link(1), link(2)] {
        assert_parity(
            &pool,
            &both,
            &and(dense.clone(), EmailLiteral::Owner(owner)),
            20,
        )
        .await?;
    }
    let either = Expr::and(
        dense.clone(),
        Expr::or(
            Expr::Literal(EmailLiteral::Owner(link(0))),
            Expr::Literal(EmailLiteral::Owner(link(1))),
        ),
    );
    assert_parity(&pool, &both, &either, 20).await?;
    // u1's inbox, named by an Owner term, stays out of the caller's read.
    let rows = assert_parity(&pool, &both, &and(dense, EmailLiteral::Owner(link(2))), 20).await?;
    assert_eq!(rows, 0);
    Ok(())
}

/// The id of the fixture's thread written by hand as `name`.
async fn hand(pool: &Pool<Postgres>, name: &str) -> anyhow::Result<Uuid> {
    Ok(
        sqlx::query_scalar!(r#"SELECT md5('owned-hand:' || $1)::uuid AS "id!""#, name)
            .fetch_one(pool)
            .await?,
    )
}

/// The general builder (and so every owned read) never lists a thread whose
/// participant is only on a message All Mail hides, and previews the newest
/// message it shows.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn hidden_messages_dont_list_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let dense = company(&["dense.test"]);
    let ids = listed(&pool, &[link(0)], &dense).await?;
    for hidden in ["spam-only", "trash-only", "missing-only"] {
        assert!(
            !ids.contains(&hand(&pool, hidden).await?),
            "{hidden} is listed"
        );
    }
    let spam_newest_id = hand(&pool, "spam-newest").await?;
    assert!(ids.contains(&spam_newest_id));
    let rows = pages(
        &pool,
        &[link(0)],
        &dense,
        100,
        Some(OwnedReadTuning::DEFAULT),
    )
    .await?
    .rows
    .concat();
    let spam_newest = rows
        .iter()
        .find(|row| row.id == spam_newest_id)
        .expect("spam-newest is listed");
    assert_eq!(
        spam_newest.snippet.as_deref(),
        Some("Snippet spam-newest:0")
    );
    assert_parity(&pool, &[link(0)], &dense, 2).await?;
    Ok(())
}

/// A request the owned read doesn't cover still reads the general builder.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn uncovered_requests_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let dense = company(&["dense.test"]);
    // Two address trees, an address under NOT, a subject term, and shared
    // threads.
    let two_trees = Expr::and(dense.clone(), company(&["dense.test", "sparse.test"]));
    assert_general(&pool, &[link(0)], &two_trees, 10).await?;
    let not_sparse = Expr::and(dense.clone(), Expr::is_not(company(&["sparse.test"])));
    assert_general(&pool, &[link(0)], &not_sparse, 10).await?;
    let subject = and(
        dense.clone(),
        EmailLiteral::Subject(SubjectQuery::try_from("Subject 1".to_owned())?),
    );
    let rows = assert_general(&pool, &[link(0)], &subject, 10).await?;
    assert!(rows > 10, "{rows}");
    let shared = and(
        dense.clone(),
        EmailLiteral::Shared(SharedEmailFilter::Include),
    );
    assert_general(&pool, &[link(0)], &shared, 10).await?;
    Ok(())
}

/// The owned read's streams by name, one per page.
async fn streams(
    pool: &Pool<Postgres>,
    caller_links: &[Uuid],
    filter: &Expr<EmailLiteral>,
    limit: u32,
    tuning: OwnedReadTuning,
) -> anyhow::Result<Vec<&'static str>> {
    let pages = pages(pool, caller_links, filter, limit, Some(tuning)).await?;
    Ok(pages
        .streams
        .into_iter()
        .map(|streams| streams.map_or("general", <&str>::from))
        .collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn each_read_takes_its_streams(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let dense = company(&["dense.test"]);
    let both = [link(0), link(1)];
    let [default, superset, inboxes, _, fallback] = READS.map(|(_, tuning)| tuning);
    // The fixture's superset is small, so the default reads it first.
    let read = streams(&pool, &both, &dense, 7, default).await?;
    assert!(read.iter().all(|name| *name == "superset"), "{read:?}");
    let read = streams(&pool, &both, &dense, 7, superset).await?;
    assert!(read.iter().all(|name| *name == "superset"), "{read:?}");
    // The inbox stream fills every page but the short last one and the
    // empty one after it.
    let read = streams(&pool, &both, &dense, 7, inboxes).await?;
    let (last, full) = read.split_last().expect("at least one page");
    assert!(full.len() > 30, "{read:?}");
    assert!(
        full[..full.len() - 1].iter().all(|name| *name == "inboxes"),
        "{read:?}"
    );
    assert_eq!(*last, "inboxes_then_superset");
    // A window of one thread per row seldom fills a page.
    let read = streams(&pool, &both, &dense, 7, fallback).await?;
    assert_eq!(read.first(), Some(&"inboxes_then_superset"), "{read:?}");
    // An Owner term outside the caller's inboxes leaves nothing to read.
    let elsewhere = and(dense.clone(), EmailLiteral::Owner(link(2)));
    assert_eq!(
        streams(&pool, &both, &elsewhere, 7, default).await?,
        ["empty"]
    );
    // No inboxes at all.
    let rows = assert_parity(&pool, &[], &dense, 10).await?;
    assert_eq!(rows, 0);
    Ok(())
}
