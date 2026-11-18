//! Parity of the owned All Mail address read (`dynamic/query/owned_scope.rs`)
//! with the general builder: each way the read can take a page returns the
//! general builder's rows, in its order, page after page, for every filter
//! shape the Sales Email view, a CRM record under Me, an All Mail address
//! search and Soup's hydration by id send. Requests the read doesn't cover
//! go to the general builder, or a team's to the team read.
//!
//! Fixtures: `email/fixtures/email_owned_address_read.sql` (generated, see
//! its header) and `email_owned_address_foreign_contacts.sql`.

use super::*;
use crate::outbound::email_pg_repo::db_types::ThreadPreviewCursorDbRow;
use crate::outbound::email_pg_repo::dynamic::{
    OwnedReadStats, OwnedReadTuning, OwnedStreams, begin_snapshot, inbox_window,
};
use item_filters::NotificationState;
use item_filters::SharedEmailFilter;
use item_filters::ast::email::{AttachmentKind, SubjectQuery};
use item_filters::ast::properties::{PropertiesLiteral, PropertyMatchValue};
use macro_user_id::cowlike::CowLike;
use std::collections::HashMap;

const CALLER: &str = "macro|u0@owned.test";

fn link(i: u8) -> Uuid {
    Uuid::from_u128(0xf100_0000_0000_0000_0000_0000_0000_0000 | u128::from(i))
}

/// Every way the owned read takes a page, by name.
const READS: [(&str, OwnedReadTuning); 7] = [
    ("default", OwnedReadTuning::DEFAULT),
    (
        "superset",
        OwnedReadTuning {
            superset_limit: i64::MAX,
            window_per_row: 20,
            ..OwnedReadTuning::DEFAULT
        },
    ),
    // Rounds that never probe.
    (
        "inboxes",
        OwnedReadTuning {
            superset_limit: -1,
            window_per_row: 1_000,
            superset_per_need: 0,
            superset_per_walked: 0,
            ..OwnedReadTuning::DEFAULT
        },
    ),
    (
        "inboxes_tight",
        OwnedReadTuning {
            superset_limit: -1,
            window_per_row: 3,
            superset_per_need: 0,
            superset_per_walked: 0,
            ..OwnedReadTuning::DEFAULT
        },
    ),
    // The superset finishes a page whenever the walk finds rows too slowly.
    (
        "inboxes_then_superset",
        OwnedReadTuning {
            superset_limit: -1,
            window_per_row: 1,
            superset_per_need: i64::MAX,
            superset_per_walked: i64::MAX,
            ..OwnedReadTuning::DEFAULT
        },
    ),
    // Probes that come up over their cap until it outgrows the superset: the
    // fixture's sparse company has 26 superset rows.
    (
        "rounds",
        OwnedReadTuning {
            superset_limit: -1,
            window_per_row: 1,
            superset_per_need: i64::MAX,
            superset_per_walked: 2,
            ..OwnedReadTuning::DEFAULT
        },
    ),
    // Windows that stop growing at 16 threads and probe caps at 27 rows: the
    // sparse company's 26 superset rows fit only the one probe at the most.
    ("capped", CAPPED),
];

/// The `capped` read: probes at one superset row per thread walked.
const CAPPED: OwnedReadTuning = OwnedReadTuning {
    superset_limit: -1,
    window_per_row: 1,
    superset_per_need: i64::MAX,
    superset_per_walked: 1,
    max_round_window: 16,
    max_superset_cap: 27,
};

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

/// A balanced OR of `trees`, as Soup builds its id trees.
fn balanced_or(mut trees: Vec<Expr<EmailLiteral>>) -> Expr<EmailLiteral> {
    while trees.len() > 1 {
        let mut pairs = trees.into_iter();
        let mut next = Vec::new();
        while let Some(first) = pairs.next() {
            next.push(match pairs.next() {
                Some(second) => Expr::or(first, second),
                None => first,
            });
        }
        trees = next;
    }
    trees.pop().expect("at least one tree")
}

fn date(day: u32) -> chrono::DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 5, day, 0, 0, 0).unwrap()
}

/// One request, paged by [`pages`]: the caller's All Mail by update unless
/// changed.
#[derive(Clone)]
struct Request<'a> {
    links: &'a [Uuid],
    filter: Expr<EmailLiteral>,
    limit: u32,
    view: PreviewView,
    sort: SimpleSortMethod,
    caller: &'a str,
    team: Option<Uuid>,
}

impl<'a> Request<'a> {
    fn all(links: &'a [Uuid], filter: &Expr<EmailLiteral>, limit: u32) -> Self {
        Self {
            links,
            filter: filter.clone(),
            limit,
            view: PreviewView::StandardLabel(PreviewViewStandardLabel::All),
            sort: SimpleSortMethod::UpdatedAt,
            caller: CALLER,
            team: None,
        }
    }

    fn view(self, label: PreviewViewStandardLabel) -> Self {
        Self {
            view: PreviewView::StandardLabel(label),
            ..self
        }
    }

    fn sort(self, sort: SimpleSortMethod) -> Self {
        Self { sort, ..self }
    }
}

/// A request's pages until one comes back empty, and how the owned read
/// took each page (`None` when the general builder read it).
struct Pages {
    rows: Vec<Vec<ThreadPreviewCursorDbRow>>,
    stats: Vec<Option<OwnedReadStats>>,
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
    request: &Request<'_>,
    read: Option<OwnedReadTuning>,
) -> anyhow::Result<Pages> {
    let filter = Arc::new(request.filter.clone());
    let mut pages = Pages {
        rows: Vec::new(),
        stats: Vec::new(),
    };
    let mut cursor = None;
    loop {
        let query = Query::new(cursor.take(), request.sort, filter.clone());
        let (page, stats) = dynamic::dynamic_email_thread_cursor_owned_with(
            pool,
            request.links,
            request.limit,
            &request.view,
            query,
            request.caller,
            request.team,
            read,
        )
        .await?;
        cursor = page.last().map(|last| Cursor {
            id: last.id,
            limit: request.limit as usize,
            val: CursorVal {
                sort_type: request.sort,
                last_val: last.sort_ts,
            },
            filter: filter.clone(),
        });
        pages.rows.push(page);
        pages.stats.push(stats);
        if cursor.is_none() {
            return Ok(pages);
        }
        anyhow::ensure!(pages.rows.len() <= 3_000, "runaway pagination");
    }
}

/// Asserts each owned read takes every page of `request` and returns the
/// general builder's pages, and returns their rows.
async fn parity(
    pool: &Pool<Postgres>,
    request: &Request<'_>,
) -> anyhow::Result<Vec<ThreadPreviewCursorDbRow>> {
    let expected = pages(pool, request, None).await?;
    assert!(expected.stats.iter().all(Option::is_none));
    for (name, tuning) in READS {
        let actual = pages(pool, request, Some(tuning)).await?;
        assert!(
            actual.stats.iter().all(Option::is_some),
            "{name} read left pages to the general builder for {:?}: {:?}",
            request.filter,
            actual.stats
        );
        assert_eq!(
            actual.printed(),
            expected.printed(),
            "{name} read differs for {:?} with {:?} in pages of {}",
            request.links,
            request.filter,
            request.limit
        );
    }
    Ok(expected.rows.concat())
}

/// [`parity`] for the caller's All Mail, returning how many rows it holds.
async fn assert_parity(
    pool: &Pool<Postgres>,
    caller_links: &[Uuid],
    filter: &Expr<EmailLiteral>,
    limit: u32,
) -> anyhow::Result<usize> {
    Ok(parity(pool, &Request::all(caller_links, filter, limit))
        .await?
        .len())
}

/// Asserts the owned read leaves every page of a request to the builder that
/// reads it without the owned read, and returns the rows.
async fn general(
    pool: &Pool<Postgres>,
    request: &Request<'_>,
) -> anyhow::Result<Vec<ThreadPreviewCursorDbRow>> {
    let expected = pages(pool, request, None).await?;
    let actual = pages(pool, request, Some(OwnedReadTuning::DEFAULT)).await?;
    assert!(
        actual.stats.iter().all(Option::is_none),
        "{:?}",
        request.filter
    );
    assert_eq!(actual.printed(), expected.printed());
    Ok(expected.rows.concat())
}

/// [`general`] for the caller's All Mail, returning how many rows it holds.
async fn assert_general(
    pool: &Pool<Postgres>,
    caller_links: &[Uuid],
    filter: &Expr<EmailLiteral>,
    limit: u32,
) -> anyhow::Result<usize> {
    Ok(general(pool, &Request::all(caller_links, filter, limit))
        .await?
        .len())
}

/// The ids of the threads the general builder lists.
async fn listed(
    pool: &Pool<Postgres>,
    caller_links: &[Uuid],
    filter: &Expr<EmailLiteral>,
) -> anyhow::Result<Vec<Uuid>> {
    Ok(ids(&pages(
        pool,
        &Request::all(caller_links, filter, 100),
        None,
    )
    .await?
    .rows
    .concat()))
}

fn ids(rows: &[ThreadPreviewCursorDbRow]) -> Vec<Uuid> {
    rows.iter().map(|row| row.id).collect()
}

/// `md5(text)` as a uuid, as the fixtures name their rows.
async fn md5_id(pool: &Pool<Postgres>, text: &str) -> anyhow::Result<Uuid> {
    Ok(
        sqlx::query_scalar!(r#"SELECT md5($1)::uuid AS "id!""#, text)
            .fetch_one(pool)
            .await?,
    )
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

/// How many listed threads share their date with another of the same inbox,
/// and with one of another inbox.
fn ties(rows: &[ThreadPreviewCursorDbRow]) -> (usize, usize) {
    let mut inboxes: HashMap<_, Vec<Uuid>> = HashMap::new();
    for row in rows {
        inboxes.entry(row.sort_ts).or_default().push(row.link_id);
    }
    let tied = inboxes.values().filter(|links| links.len() > 1);
    let same = tied
        .clone()
        .filter(|links| {
            links
                .iter()
                .any(|a| links.iter().filter(|b| *b == a).count() > 1)
        })
        .count();
    let across = tied
        .filter(|links| links.iter().any(|a| links.iter().any(|b| b != a)))
        .count();
    (same, across)
}

/// Threads with equal dates, in one inbox and across inboxes, page by id.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn tied_dates_page_alike(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let both = [link(0), link(1)];
    let dense = company(&["dense.test"]);
    for limit in [1, 2] {
        let rows = parity(&pool, &Request::all(&both, &dense, limit)).await?;
        let (same, across) = ties(&rows);
        assert!(
            same > 3 && across > 3,
            "ties: {same} in an inbox, {across} across"
        );
    }
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
    // A search on one sender, and on one recipient.
    let from = Expr::Literal(EmailLiteral::Sender(complete("p2@sparse.test")));
    let rows = assert_parity(&pool, &[link(0), link(1)], &from, 3).await?;
    assert!(rows > 0, "{rows}");
    let to = Expr::Literal(EmailLiteral::Recipient(complete("p0@dense.test")));
    let rows = assert_parity(&pool, &[link(0), link(1)], &to, 6).await?;
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

/// Negated facets read in page order; a message term beside the addresses,
/// alone or mixed with a thread term, goes to the general builder.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn negated_and_mixed_terms_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let both = [link(0), link(1)];
    let dense = company(&["dense.test"]);
    for literal in [
        EmailLiteral::Importance(true),
        EmailLiteral::Read(true),
        EmailLiteral::Attachment(AttachmentKind::Pdf),
        EmailLiteral::CalendarOnly(true),
    ] {
        let not = Expr::and(dense.clone(), Expr::is_not(Expr::Literal(literal)));
        let rows = assert_parity(&pool, &both, &not, 9).await?;
        assert!(rows > 50, "{rows}");
    }
    let subject_or_signal = Expr::and(
        dense.clone(),
        Expr::or(
            Expr::Literal(EmailLiteral::Subject(SubjectQuery::try_from(
                "Subject 1".to_owned(),
            )?)),
            Expr::Literal(EmailLiteral::Importance(true)),
        ),
    );
    // A message term beside the addresses goes to the general builder.
    let rows = assert_general(&pool, &both, &subject_or_signal, 9).await?;
    assert!(rows > 50, "{rows}");
    let not_subject = Expr::and(
        dense.clone(),
        Expr::is_not(Expr::Literal(EmailLiteral::Subject(
            SubjectQuery::try_from("Subject 1".to_owned())?,
        ))),
    );
    let rows = assert_general(&pool, &both, &not_subject, 9).await?;
    assert!(rows > 50, "{rows}");
    Ok(())
}

/// Thread terms the streams apply as they read: Soup's hydration by id,
/// dates, notification states, a property and calendar threads.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn thread_terms_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let both = [link(0), link(1)];
    let dense = company(&["dense.test"]);
    // Soup hydrates listed threads by id under the list's template, in one
    // page of as many rows as ids; some ids here don't match the template.
    let mut threads = listed(&pool, &both, &dense).await?;
    threads.truncate(40);
    threads.extend(
        listed(&pool, &both, &company(&["other3.test", "other4.test"]))
            .await?
            .into_iter()
            .take(10),
    );
    let by_id = Expr::and(
        balanced_or(
            threads
                .iter()
                .map(|id| Expr::Literal(EmailLiteral::ThreadId(*id)))
                .collect(),
        ),
        dense.clone(),
    );
    let rows = parity(&pool, &Request::all(&both, &by_id, threads.len() as u32)).await?;
    assert_eq!(rows.len(), 40);
    for term in [
        EmailLiteral::CreatedAt(DateLiteral::GreaterThan(date(25))),
        EmailLiteral::UpdatedAt(DateLiteral::LessThanOrEqual(date(25))),
        EmailLiteral::NotificationState(NotificationState::Unseen),
        EmailLiteral::NotificationState(NotificationState::Seen),
        EmailLiteral::NotificationState(NotificationState::Done),
        EmailLiteral::CalendarOnly(true),
        EmailLiteral::Property(PropertiesLiteral {
            property_definition_id: md5_id(&pool, "owned-property").await?,
            entity_type: None,
            value: PropertyMatchValue::SelectOption(md5_id(&pool, "owned-option1").await?),
        }),
    ] {
        let rows = assert_parity(&pool, &both, &and(dense.clone(), term.clone()), 4).await?;
        assert!(rows > 3, "{term:?}: {rows}");
    }
    let window = and(
        and(
            dense.clone(),
            EmailLiteral::UpdatedAt(DateLiteral::LessThan(date(28))),
        ),
        EmailLiteral::CreatedAt(DateLiteral::GreaterThanOrEqual(date(20))),
    );
    let rows = assert_parity(&pool, &both, &window, 6).await?;
    assert!(rows > 50, "{rows}");
    // All Mail sorts by its own date under either sort.
    let rows = parity(
        &pool,
        &Request::all(&both, &dense, 13).sort(SimpleSortMethod::CreatedAt),
    )
    .await?;
    assert!(rows.len() > 200, "{}", rows.len());
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

/// A repeated inbox reads as one, in either read.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn repeated_inboxes_read_once(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let dense = company(&["dense.test"]);
    let once = [link(0), link(1)];
    let repeated = [link(0), link(1), link(0)];
    let expected = pages(&pool, &Request::all(&once, &dense, 30), None).await?;
    let reads = [None]
        .into_iter()
        .chain(READS.map(|(_, tuning)| Some(tuning)));
    for read in reads {
        let actual = pages(&pool, &Request::all(&repeated, &dense, 30), read).await?;
        assert_eq!(actual.printed(), expected.printed(), "{read:?}");
    }
    Ok(())
}

/// The id of the fixture's thread written by hand as `name`.
async fn hand(pool: &Pool<Postgres>, name: &str) -> anyhow::Result<Uuid> {
    md5_id(pool, &format!("owned-hand:{name}")).await
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
        &Request::all(&[link(0)], &dense, 100),
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

/// The snippet of each listed thread the foreign-contacts fixture wrote, by
/// name.
async fn foreign_listed(
    pool: &Pool<Postgres>,
    rows: &[ThreadPreviewCursorDbRow],
) -> anyhow::Result<Vec<(&'static str, Option<String>)>> {
    let mut listed = Vec::new();
    for name in [
        "foreign-only",
        "foreign-newest",
        "junk-and-foreign",
        "trash-and-foreign",
        "second-inbox-contact",
        "foreign-copy",
        "foreign-recipient",
        "own-match-foreign-copy",
    ] {
        let id = md5_id(pool, &format!("owned-foreign:{name}")).await?;
        if let Some(row) = rows.iter().find(|row| row.id == id) {
            listed.push((name, row.snippet.clone()));
        }
    }
    Ok(listed)
}

/// A message that lists another inbox's contact lists its thread only when a
/// present message outside trash matches through the queried inboxes' own
/// contacts, as the general builder's `matching_threads` requires, whichever
/// stream reads the page; the preview is still the newest message that
/// matches.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_owned_address_read", "email_owned_address_foreign_contacts")
    )
)]
async fn other_inboxes_contacts_list_as_in_general(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let both = [link(0), link(1)];
    let snippet = |text: &str| Some(text.to_owned());
    for tree in [
        company(&["dense.test"]),
        any_direction(Email::Partial("@dense".to_owned())),
        Expr::Literal(EmailLiteral::Sender(Email::Domain("dense.test".to_owned()))),
    ] {
        let mut expected = vec![
            ("foreign-newest", snippet("Snippet foreign-newest:1")),
            ("junk-and-foreign", snippet("Snippet junk-and-foreign:1")),
            (
                "second-inbox-contact",
                snippet("Snippet second-inbox-contact:0"),
            ),
            (
                "own-match-foreign-copy",
                snippet("Snippet own-match-foreign-copy:0"),
            ),
        ];
        for limit in [1, 4, 100] {
            let rows = parity(&pool, &Request::all(&both, &tree, limit)).await?;
            assert_eq!(foreign_listed(&pool, &rows).await?, expected, "{tree:?}");
        }
        // Under one Owner term the contacts of every queried inbox still count.
        let mine = and(tree.clone(), EmailLiteral::Owner(link(0)));
        let rows = parity(&pool, &Request::all(&both, &mine, 3)).await?;
        assert_eq!(foreign_listed(&pool, &rows).await?, expected, "{tree:?}");
        // Without the second inbox, its contact is another inbox's.
        expected.retain(|(name, _)| *name != "second-inbox-contact");
        let rows = parity(&pool, &Request::all(&[link(0)], &tree, 3)).await?;
        assert_eq!(foreign_listed(&pool, &rows).await?, expected, "{tree:?}");
    }
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

/// Other views, and the viewed sorts and terms, which read the caller's view
/// history, go to the general builder.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn other_views_and_viewed_requests_read_general(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let both = [link(0), link(1)];
    let dense = company(&["dense.test"]);
    for label in [
        PreviewViewStandardLabel::Inbox,
        PreviewViewStandardLabel::Important,
    ] {
        let rows = general(&pool, &Request::all(&both, &dense, 25).view(label)).await?;
        assert!(!rows.is_empty(), "{label:?}");
    }
    for sort in [SimpleSortMethod::ViewedAt, SimpleSortMethod::ViewedUpdated] {
        let rows = general(&pool, &Request::all(&both, &dense, 25).sort(sort)).await?;
        assert!(rows.len() > 10, "{sort:?}: {}", rows.len());
    }
    let viewed = and(
        dense.clone(),
        EmailLiteral::ViewedAt(DateLiteral::GreaterThan(date(1))),
    );
    let rows = general(&pool, &Request::all(&both, &viewed, 25)).await?;
    assert!(rows.len() > 10, "{}", rows.len());
    Ok(())
}

/// A request in a project reads the threads shared into it, so it goes to
/// the general builder.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn project_requests_read_general(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let both = [link(0), link(1)];
    let project = md5_id(&pool, "owned-project").await?.to_string();
    let in_project = and(company(&["dense.test"]), EmailLiteral::ProjectId(project));
    let rows = general(&pool, &Request::all(&both, &in_project, 7)).await?;
    assert!(rows.iter().any(|row| row.link_id == link(0)));
    assert!(
        rows.iter().any(|row| row.link_id == link(2)),
        "the project's threads of u1's inbox are listed"
    );
    Ok(())
}

/// A team request applies the CRM's privacy rule and lists each
/// conversation once, so the owned read leaves it to the team read.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_dedupe")
    )
)]
async fn team_requests_read_general(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team = Uuid::parse_str("e0000002-0000-0000-0000-000000000002")?;
    let dave = [Uuid::parse_str("d0000001-0000-0000-0000-000000000001")?];
    // Each member's copy of conversations X, Z and W (Dave) and X, Y and W
    // (Erin), as `email_dynamic_query_crm_dedupe.sql` names them.
    let thread = |member: u8, conversation: u8| {
        Uuid::parse_str(&format!(
            "5555000{member}-0000-0000-0000-00000000000{conversation}"
        ))
    };
    let (dave_x, dave_z, dave_w) = (thread(1, 1)?, thread(1, 2)?, thread(1, 3)?);
    let (erin_x, erin_y, erin_w) = (thread(2, 1)?, thread(2, 2)?, thread(2, 3)?);
    let acme = Expr::Literal(EmailLiteral::Sender(Email::Domain(
        "acme.example.com".to_owned(),
    )));
    let caller = sqlx::query_scalar!("SELECT macro_id FROM email_links WHERE id = $1", dave[0])
        .fetch_one(&pool)
        .await?;
    let request = Request {
        caller: &caller,
        team: Some(team),
        ..Request::all(&dave, &acme, 100)
    };
    // One row per conversation, the caller's copy where the caller has one.
    assert_eq!(
        ids(&general(&pool, &request).await?),
        [dave_z, dave_x, erin_y, dave_w]
    );
    // The caller's block on the domain hides the caller's own copies from the
    // team's view.
    sqlx::query!(
        "INSERT INTO crm_personal_email_blocklist (team_id, user_id, domain) \
         VALUES ($1, $2, 'acme.example.com')",
        team,
        caller
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        ids(&general(&pool, &request).await?),
        [erin_w, erin_y, erin_x]
    );
    Ok(())
}

/// How the owned read took each page.
async fn taken(
    pool: &Pool<Postgres>,
    caller_links: &[Uuid],
    filter: &Expr<EmailLiteral>,
    limit: u32,
    tuning: OwnedReadTuning,
) -> anyhow::Result<Vec<OwnedReadStats>> {
    let pages = pages(
        pool,
        &Request::all(caller_links, filter, limit),
        Some(tuning),
    )
    .await?;
    pages
        .stats
        .into_iter()
        .map(|stats| stats.ok_or_else(|| anyhow::anyhow!("the general builder read a page")))
        .collect()
}

/// The owned read's streams by name, one per page.
async fn streams(
    pool: &Pool<Postgres>,
    caller_links: &[Uuid],
    filter: &Expr<EmailLiteral>,
    limit: u32,
    tuning: OwnedReadTuning,
) -> anyhow::Result<Vec<&'static str>> {
    let pages = pages(
        pool,
        &Request::all(caller_links, filter, limit),
        Some(tuning),
    )
    .await?;
    Ok(pages
        .stats
        .into_iter()
        .map(|stats| stats.map_or("general", |stats| <&str>::from(stats.streams)))
        .collect())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_owned_address_read"))
)]
async fn each_read_takes_its_streams(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let dense = company(&["dense.test"]);
    let sparse = company(&["sparse.test"]);
    let both = [link(0), link(1)];
    let [default, superset, inboxes, tight, fallback, rounds, _] = READS.map(|(_, tuning)| tuning);
    // The fixture's superset is small, so the default reads it first.
    let read = streams(&pool, &both, &dense, 7, default).await?;
    assert!(read.iter().all(|name| *name == "superset"), "{read:?}");
    let read = streams(&pool, &both, &dense, 7, superset).await?;
    assert!(read.iter().all(|name| *name == "superset"), "{read:?}");
    // The inbox stream fills every page but the last ones, whose window
    // holds every thread left, so the superset never runs.
    let read = streams(&pool, &both, &dense, 7, inboxes).await?;
    let (last, full) = read.split_last().expect("at least one page");
    assert!(full.len() > 30, "{read:?}");
    assert!(
        full[..full.len() - 1].iter().all(|name| *name == "inboxes"),
        "{read:?}"
    );
    assert_eq!(*last, "inboxes_to_end");
    // Rounds that only walk fill the pages a small first window leaves short.
    let read = streams(&pool, &both, &dense, 7, tight).await?;
    assert!(read.contains(&"inboxes_then_inboxes"), "{read:?}");
    assert!(!read.contains(&"inboxes_then_superset"), "{read:?}");
    // A first window that finds rows at the page's rate walks on; one that
    // finds too few leaves the page to the superset.
    let read = streams(&pool, &both, &dense, 7, fallback).await?;
    assert!(read.contains(&"inboxes_then_inboxes"), "{read:?}");
    assert!(read.contains(&"inboxes_then_superset"), "{read:?}");
    // The first round's probe fits the sparse company's superset.
    let read = taken(&pool, &both, &sparse, 7, fallback).await?;
    assert_eq!(
        read[0].streams,
        OwnedStreams::InboxesThenSuperset,
        "{read:?}"
    );
    assert_eq!(read[0].probes, 2, "{read:?}");
    // Probes the superset outgrows walk on, until a cap fits it.
    let read = taken(&pool, &both, &sparse, 7, rounds).await?;
    assert_eq!(
        read[0].streams,
        OwnedStreams::InboxesThenSuperset,
        "{read:?}"
    );
    assert!(read[0].probes > 2, "{read:?}");
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

/// A page whose first window found most of its rows, with nothing below
/// them: a busy company's last page, and the empty page after it.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_owned_address_read", "email_owned_address_busy")
    )
)]
async fn a_window_without_rows_probes_the_superset(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let busy = company(&["busy.test"]);
    let inbox = [link(0)];
    assert_eq!(assert_parity(&pool, &inbox, &busy, 10).await?, 9);
    // The 5,400-row superset is past the first probe. The first window, 100
    // threads, holds all nine rows of the first page, and the round below
    // it 400 threads without one. So the next round probes at 50 superset
    // rows per thread walked, which fits, rather than walking on at the
    // page's rate to the end of the inbox. The page after it walks the
    // same windows, finding nothing.
    let probed = OwnedReadStats {
        streams: OwnedStreams::InboxesThenSuperset,
        rounds: 2,
        probes: 2,
        probe_cap: Some(25_000),
        walked: 500,
    };
    assert_eq!(
        taken(&pool, &inbox, &busy, 10, OwnedReadTuning::DEFAULT).await?,
        [probed, probed]
    );
    Ok(())
}

/// The `capped` read, whose rounds reach their most window and cap.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_owned_address_read", "email_owned_address_busy")
    )
)]
async fn rounds_stop_at_their_most(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let inbox = [link(0)];
    let busy = company(&["busy.test"]);
    let read = taken(&pool, &inbox, &busy, 10, CAPPED).await?;
    let first = read[0];
    assert_eq!(first.streams, OwnedStreams::InboxesThenInboxes, "{read:?}");
    // Every round's window is the most, 16 threads, past the first
    // window's 10.
    assert!(first.rounds > 3, "{read:?}");
    assert_eq!(first.walked, 10 + 16 * i64::from(first.rounds), "{read:?}");
    // The probes at 10 (one row per thread walked) and at 27, the most,
    // came up short of the 5,400-row superset. Caps of 26 and less than 40
    // would recount the first, and the most never runs twice.
    assert_eq!(first.probes, 3, "{read:?}");
    assert_eq!(first.probe_cap, Some(27), "{read:?}");
    // The sparse company's 26 superset rows outgrow the probe at 7 rows, and
    // the next caps under 28 only fit at the most, 27, which probes once.
    let sparse = company(&["sparse.test"]);
    let read = taken(&pool, &inbox, &sparse, 7, CAPPED).await?;
    assert_eq!(
        read[0].streams,
        OwnedStreams::InboxesThenSuperset,
        "{read:?}"
    );
    assert_eq!(read[0].probe_cap, Some(27), "{read:?}");
    assert_eq!(read[0].probes, 3, "{read:?}");
    Ok(())
}

/// The read's statements share one snapshot and write nothing.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reads_share_one_snapshot(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let mut transaction = begin_snapshot(&pool).await?;
    let settings = sqlx::query!(
        r#"SELECT current_setting('transaction_isolation') AS "isolation!",
                  current_setting('transaction_read_only') AS "read_only!""#
    )
    .fetch_one(&mut *transaction)
    .await?;
    assert_eq!(settings.isolation, "repeatable read");
    assert_eq!(settings.read_only, "on");
    transaction.commit().await?;
    Ok(())
}

#[test]
fn window_grows_with_the_page_up_to_its_cap() {
    assert_eq!(inbox_window(20, 10), 200);
    assert_eq!(inbox_window(100, 10), 1_000);
    assert_eq!(inbox_window(500, 10), 1_000);
    assert_eq!(inbox_window(i64::MAX, 2), 1_000);
    assert_eq!(inbox_window(7, 0), 1);
}

#[test]
fn round_cap_follows_the_walk_left() {
    let tuning = OwnedReadTuning::DEFAULT;
    // 2 rows in the last 1,000 threads: 49,000 more threads at that rate,
    // so the cap is the walk so far's 50 rows per thread.
    assert_eq!(tuning.round_cap(1_000, 1_000, 2, 98), 50_000);
    // 16 rows: 5,250 more threads, 3 rows each.
    assert_eq!(tuning.round_cap(1_000, 1_000, 16, 84), 15_750);
    // The last window's rate, not the walk's: 2 rows in its 4,000 threads
    // leave 20,000 more for the last 10 rows.
    assert_eq!(tuning.round_cap(5_000, 4_000, 2, 10), 60_000);
    // A window without rows gives no rate: only the walk bounds the cap.
    assert_eq!(tuning.round_cap(5_000, 4_000, 0, 1), 250_000);
    assert_eq!(tuning.round_cap(100, 100, 0, 100), 5_000);
    assert_eq!(tuning.round_cap(1_000_000, 16_000, 0, 100), 800_000);
    assert_eq!(tuning.round_cap(i64::MAX, i64::MAX, 0, i64::MAX), 800_000);
    assert_eq!(CAPPED.round_cap(100, 16, 0, 5), 27);
}

#[test]
fn probes_grow_and_end_at_the_most() {
    let tuning = OwnedReadTuning::DEFAULT;
    // The first round probe needs four times the 5,000-row probe.
    assert!(!tuning.probes_again(19_999, 5_000));
    assert!(tuning.probes_again(20_000, 5_000));
    // Without rows the caps go 50,000 and 250,000; past a short probe at
    // 250,000 only the most is left.
    assert!(tuning.probes_again(250_000, 50_000));
    assert!(!tuning.probes_again(799_999, 250_000));
    assert!(tuning.probes_again(800_000, 250_000));
    // Once the most came up short, nothing probes again.
    assert!(!tuning.probes_again(800_000, 800_000));
    assert!(CAPPED.probes_again(27, 10));
    assert!(!CAPPED.probes_again(27, 27));
}

mod sender_probe_cap;
