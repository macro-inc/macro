//! Parity of the team-scoped (CRM) All Mail read
//! (`dynamic/query/team_scope.rs`) with the general builder: each way the
//! read can take a page returns the general builder's rows, in its order,
//! page after page, for every filter shape a CRM record sends.
//!
//! Fixture: `email/fixtures/email_crm_team_read.sql` (generated, see its
//! header), and the dedupe fixtures of `crm_scope_dynamic_query`.

use super::*;
use crate::outbound::email_pg_repo::db_types::ThreadPreviewCursorDbRow;
use crate::outbound::email_pg_repo::dynamic::TeamReadTuning;
use macro_user_id::cowlike::CowLike;

const TEAM_GAMMA_ID: &str = "e0000003-0000-0000-0000-000000000003";
const TEAM_DELTA_ID: &str = "e0000004-0000-0000-0000-000000000004";

fn link(i: u8) -> Uuid {
    Uuid::from_u128(0xf000_0000_0000_0000_0000_0000_0000_0000 | u128::from(i))
}

fn user(i: u8) -> String {
    format!("macro|u{i}@gamma.test")
}

/// Every way the team read takes a page, by name.
const READS: [(&str, TeamReadTuning); 4] = [
    ("default", TeamReadTuning::DEFAULT),
    (
        "superset",
        TeamReadTuning {
            superset_limit: i64::MAX,
            window_per_row: 20,
        },
    ),
    (
        "inboxes",
        TeamReadTuning {
            superset_limit: -1,
            window_per_row: 1_000,
        },
    ),
    (
        "inboxes_then_superset",
        TeamReadTuning {
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
        .map(|address| {
            any_direction(Email::Complete(
                EmailStr::parse_from_str(address).unwrap().into_owned(),
            ))
        })
        .reduce(Expr::or)
        .unwrap()
}

fn signal(tree: Expr<EmailLiteral>) -> Expr<EmailLiteral> {
    Expr::and(tree, Expr::Literal(EmailLiteral::Importance(true)))
}

fn me(tree: Expr<EmailLiteral>, owner: Uuid) -> Expr<EmailLiteral> {
    Expr::and(tree, Expr::Literal(EmailLiteral::Owner(owner)))
}

/// The pages a caller reads until one comes back empty.
async fn pages(
    pool: &Pool<Postgres>,
    team: &str,
    caller_links: &[Uuid],
    caller: &str,
    filter: &Expr<EmailLiteral>,
    limit: u32,
    read: Option<TeamReadTuning>,
) -> anyhow::Result<Vec<Vec<ThreadPreviewCursorDbRow>>> {
    let team = Uuid::parse_str(team)?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::All);
    let filter = Arc::new(filter.clone());
    let mut pages = Vec::new();
    let mut cursor = None;
    loop {
        let query = Query::new(cursor.take(), SimpleSortMethod::UpdatedAt, filter.clone());
        let page = dynamic::dynamic_email_thread_cursor_with(
            pool,
            caller_links,
            limit,
            &view,
            query,
            caller,
            Some(team),
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
        pages.push(page);
        if cursor.is_none() {
            return Ok(pages);
        }
        anyhow::ensure!(pages.len() <= 3_000, "runaway pagination");
    }
}

/// Each row of the pages in full, to compare.
fn printed(pages: &[Vec<ThreadPreviewCursorDbRow>]) -> Vec<Vec<String>> {
    pages
        .iter()
        .map(|page| page.iter().map(|row| format!("{row:?}")).collect())
        .collect()
}

/// Asserts each team read returns the general builder's pages, and returns
/// how many rows those pages hold.
async fn assert_parity(
    pool: &Pool<Postgres>,
    team: &str,
    caller_links: &[Uuid],
    caller: &str,
    filter: &Expr<EmailLiteral>,
    limit: u32,
) -> anyhow::Result<usize> {
    let expected = printed(&pages(pool, team, caller_links, caller, filter, limit, None).await?);
    for (name, tuning) in READS {
        let actual = printed(
            &pages(
                pool,
                team,
                caller_links,
                caller,
                filter,
                limit,
                Some(tuning),
            )
            .await?,
        );
        assert_eq!(
            actual, expected,
            "{name} read differs for {caller} with {filter:?} in pages of {limit}"
        );
    }
    Ok(expected.iter().map(Vec::len).sum())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn company_pages_match_for_every_caller(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let dense = company(&["dense.test"]);
    let rows = assert_parity(&pool, TEAM_GAMMA_ID, &[link(0)], &user(0), &dense, 7).await?;
    assert!(
        rows > 300,
        "the company covers much of the team's mail: {rows}"
    );
    assert_parity(&pool, TEAM_GAMMA_ID, &[link(1)], &user(1), &dense, 100).await?;
    // A member who doesn't contribute, and a caller with a second inbox.
    assert_parity(&pool, TEAM_GAMMA_ID, &[link(3)], &user(3), &dense, 100).await?;
    assert_parity(
        &pool,
        TEAM_GAMMA_ID,
        &[link(0), link(5)],
        &user(0),
        &dense,
        100,
    )
    .await?;
    Ok(())
}

/// Another team's member consents and holds mail on the same domains and
/// addresses in a primary inbox (u9's link 10, in Team Delta). Gamma never
/// reads it, whichever stream a page comes from, while Delta's read does.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn another_teams_mail_never_shows(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let delta_inbox = link(10);
    let reads: Vec<(&str, Option<TeamReadTuning>)> = std::iter::once(("general", None))
        .chain(READS.map(|(name, tuning)| (name, Some(tuning))))
        .collect();
    for record in [company(&["dense.test"]), contact(&["p1@dense.test"])] {
        for &(name, read) in &reads {
            let gamma = pages(
                &pool,
                TEAM_GAMMA_ID,
                &[link(0)],
                &user(0),
                &record,
                100,
                read,
            )
            .await?;
            let rows: Vec<&ThreadPreviewCursorDbRow> = gamma.iter().flatten().collect();
            assert!(!rows.is_empty(), "{name} read of {record:?} is empty");
            assert!(
                rows.iter().all(|row| row.link_id != delta_inbox),
                "{name} read of {record:?} shows Delta's inbox"
            );
        }
        let rows =
            assert_parity(&pool, TEAM_DELTA_ID, &[delta_inbox], &user(9), &record, 100).await?;
        assert!(
            rows > 10,
            "Delta reads its own inbox's mail on {record:?}: {rows}"
        );
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn rare_and_old_companies_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let sparse = company(&["sparse.test"]);
    let rows = assert_parity(&pool, TEAM_GAMMA_ID, &[link(0)], &user(0), &sparse, 1).await?;
    assert!(rows > 5, "sparse.test has a few threads: {rows}");
    // Only the oldest mail: the inbox stream's window holds none of it.
    let old = company(&["old.test"]);
    let rows = assert_parity(&pool, TEAM_GAMMA_ID, &[link(0)], &user(0), &old, 10).await?;
    assert!(rows > 20, "old.test has the oldest threads: {rows}");
    let both = company(&["sparse.test", "old.test", "unknown.test"]);
    assert_parity(&pool, TEAM_GAMMA_ID, &[link(0)], &user(0), &both, 25).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn blocked_domains_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Team blocklist, a hidden company's subdomain, and u1's personal list.
    // The privacy rule ignores drafts, so the one thread whose only
    // blocked.test participants are on a draft still shows.
    for (domain, shown) in [("blocked.test", 1), ("mail.hidden.test", 0)] {
        let rows = assert_parity(
            &pool,
            TEAM_GAMMA_ID,
            &[link(0)],
            &user(0),
            &company(&[domain]),
            100,
        )
        .await?;
        assert_eq!(
            rows, shown,
            "{domain} is blocked for the whole team except on drafts"
        );
    }
    let personal = company(&["personal.test"]);
    let rows = assert_parity(&pool, TEAM_GAMMA_ID, &[link(1)], &user(1), &personal, 5).await?;
    assert!(rows > 0, "only u1's copies are blocked");
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn contact_pages_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let one = contact(&["p1@dense.test"]);
    let rows = assert_parity(&pool, TEAM_GAMMA_ID, &[link(0)], &user(0), &one, 9).await?;
    assert!(rows > 50, "the contact is on many threads: {rows}");
    let several = contact(&["p0@sparse.test", "P2@Old.test", "nobody@dense.test"]);
    assert_parity(&pool, TEAM_GAMMA_ID, &[link(2)], &user(2), &several, 4).await?;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn signal_and_me_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let dense = company(&["dense.test"]);
    let rows = assert_parity(
        &pool,
        TEAM_GAMMA_ID,
        &[link(0)],
        &user(0),
        &signal(dense.clone()),
        8,
    )
    .await?;
    assert!(rows > 30, "Signal keeps a fifth of the threads: {rows}");
    for owner in [link(0), link(1), link(3)] {
        assert_parity(
            &pool,
            TEAM_GAMMA_ID,
            &[link(0)],
            &user(0),
            &me(dense.clone(), owner),
            50,
        )
        .await?;
        assert_parity(
            &pool,
            TEAM_GAMMA_ID,
            &[link(0)],
            &user(0),
            &signal(me(dense.clone(), owner)),
            50,
        )
        .await?;
    }
    Ok(())
}

/// Every inbox knows the fixture's addresses, and the read keeps only the
/// contacts of the inboxes it reads: one inbox under Me, none when the
/// address lives only in an inbox that doesn't contribute.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn contacts_outside_the_inboxes_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let busy = contact(&["p1@dense.test"]);
    for owner in [link(0), link(1), link(3)] {
        assert_parity(
            &pool,
            TEAM_GAMMA_ID,
            &[link(0)],
            &user(0),
            &me(busy.clone(), owner),
            20,
        )
        .await?;
        assert_parity(
            &pool,
            TEAM_GAMMA_ID,
            &[link(0)],
            &user(0),
            &signal(me(busy.clone(), owner)),
            20,
        )
        .await?;
    }

    // An address only u3's inbox, which doesn't contribute, knows.
    let only_u3 = Uuid::from_u128(0xc3);
    sqlx::query!(
        r#"
        INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
        VALUES ($1, $2, 'only@u3.test', NULL, NOW(), NOW())
        "#,
        only_u3,
        link(3),
    )
    .execute(&pool)
    .await?;
    let moved = sqlx::query!(
        "UPDATE email_messages SET from_contact_id = $1 WHERE link_id = $2 AND NOT is_draft",
        only_u3,
        link(3),
    )
    .execute(&pool)
    .await?
    .rows_affected();
    assert!(moved > 0, "u3's inbox holds mail");
    let rows = assert_parity(
        &pool,
        TEAM_GAMMA_ID,
        &[link(0)],
        &user(0),
        &contact(&["only@u3.test"]),
        20,
    )
    .await?;
    assert_eq!(rows, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn a_copy_keyed_by_a_thread_id_dedupes(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Conversation 7: u0's copy has no Message-ID, and u2's root message
    // carries u0's thread id as its Message-ID, so both share one key.
    let own = sqlx::query_scalar!(r#"SELECT md5('thread0:7')::uuid AS "id!""#)
        .fetch_one(&pool)
        .await?;
    let teammate = sqlx::query_scalar!(r#"SELECT md5('thread2:7')::uuid AS "id!""#)
        .fetch_one(&pool)
        .await?;
    let dense = company(&["dense.test"]);
    for read in [None, Some(TeamReadTuning::DEFAULT)] {
        let rows = pages(
            &pool,
            TEAM_GAMMA_ID,
            &[link(0)],
            &user(0),
            &dense,
            100,
            read,
        )
        .await?
        .concat();
        let shows = |id: Uuid| rows.iter().any(|row| row.id == id);
        assert!(shows(own), "the caller's copy represents conversation 7");
        assert!(!shows(teammate), "the teammate's copy dedupes into it");
    }
    Ok(())
}

/// The user who owns `link`, read from the fixture.
async fn owner_of(pool: &Pool<Postgres>, link: Uuid) -> anyhow::Result<String> {
    Ok(
        sqlx::query_scalar!("SELECT macro_id FROM email_links WHERE id = $1", link)
            .fetch_one(pool)
            .await?,
    )
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts(
            "email_dynamic_query_crm_dedupe",
            "email_dynamic_query_crm_dedupe_divergent"
        )
    )
)]
async fn dedupe_fixture_pages_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const TEAM_BETA_ID: &str = "e0000002-0000-0000-0000-000000000002";
    let acme = company(&["acme.example.com"]);
    for link in [
        "d0000001-0000-0000-0000-000000000001",
        "d0000002-0000-0000-0000-000000000002",
    ] {
        let link = Uuid::parse_str(link)?;
        let caller = owner_of(&pool, link).await?;
        for limit in [1, 2, 100] {
            let rows = assert_parity(&pool, TEAM_BETA_ID, &[link], &caller, &acme, limit).await?;
            assert!(rows > 0, "the fixture has Acme mail");
        }
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn scope_fixture_pages_match(pool: Pool<Postgres>) -> anyhow::Result<()> {
    const TEAM_ALPHA_ID: &str = "e0000001-0000-0000-0000-000000000001";
    let alice = Uuid::parse_str("a0000001-0000-0000-0000-000000000001")?;
    let bob = Uuid::parse_str("a0000002-0000-0000-0000-000000000002")?;
    // A contact the fixture knows by its address on alice's inbox only.
    let to_target: String = sqlx::query_scalar!(
        "SELECT email_address FROM email_contacts WHERE id = 'c0000005-0000-0000-0000-000000000005'"
    )
    .fetch_one(&pool)
    .await?;
    for filter in [
        company(&["acme.example.com", "elsewhere.com"]),
        contact(&["outsider@acme.example.com", &to_target]),
    ] {
        for (link, limit) in [(alice, 1), (bob, 100)] {
            let caller = owner_of(&pool, link).await?;
            let rows =
                assert_parity(&pool, TEAM_ALPHA_ID, &[link], &caller, &filter, limit).await?;
            assert!(rows > 0, "{filter:?} matches the fixture");
        }
    }
    Ok(())
}
