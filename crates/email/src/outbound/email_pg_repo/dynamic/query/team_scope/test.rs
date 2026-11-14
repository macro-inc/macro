use super::*;
use crate::outbound::email_pg_repo::dynamic::resolve::{ResolvedFilters, resolve_filters};
use chrono::{TimeZone, Utc};
use item_filters::ast::email::Email;
use macro_user_id::cowlike::CowLike;
use macro_user_id::email::EmailStr;
use models_pagination::SimpleSortMethod;
use sqlx::Execute;

const TEAM: Uuid = Uuid::from_u128(0xf1);
const OWN: Uuid = Uuid::from_u128(1);
const TEAMMATE: Uuid = Uuid::from_u128(2);
const NOT_CONTRIBUTING: Uuid = Uuid::from_u128(3);
/// The team of the `email_crm_team_read` fixture.
const GAMMA: &str = "e0000003-0000-0000-0000-000000000003";
/// The fixture's other team, whose member u9 consents.
const DELTA: &str = "e0000004-0000-0000-0000-000000000004";

fn all_mail() -> PreviewView {
    PreviewView::StandardLabel(PreviewViewStandardLabel::All)
}

fn any_direction(domain: &str) -> Expr<EmailLiteral> {
    let literal =
        |make: fn(Email) -> EmailLiteral| Expr::Literal(make(Email::Domain(domain.to_string())));
    Expr::Or(
        Box::new(Expr::Or(
            Box::new(literal(EmailLiteral::Sender)),
            Box::new(literal(EmailLiteral::Cc)),
        )),
        Box::new(Expr::Or(
            Box::new(literal(EmailLiteral::Bcc)),
            Box::new(literal(EmailLiteral::Recipient)),
        )),
    )
}

/// The CRM page's filter: the record's addresses AND Signal AND Me.
fn signal_and_me(owner: Uuid) -> Expr<EmailLiteral> {
    Expr::And(
        Box::new(any_direction("example.test")),
        Box::new(Expr::And(
            Box::new(Expr::Literal(EmailLiteral::Importance(true))),
            Box::new(Expr::Literal(EmailLiteral::Owner(owner))),
        )),
    )
}

fn params(sort: SimpleSortMethod) -> QueryParams {
    QueryParams {
        link_ids: vec![OWN],
        sort_method_str: sort.to_string(),
        query_limit: 100,
        cursor_timestamp: None,
        cursor_id_str: None,
        is_important: false,
        shared: SharedEmailFilter::Exclude,
        user_id: "test-user".to_string(),
        resolved: ResolvedFilters::empty()
            .with_team_links(vec![OWN, TEAMMATE, NOT_CONTRIBUTING])
            .with_contributing_links(vec![OWN, TEAMMATE]),
        team_id: Some(TEAM),
        project_scope: None,
    }
}

fn team_read<'a>(
    view: &'a PreviewView,
    filter: &'a Expr<EmailLiteral>,
    params: QueryParams,
) -> Option<TeamRead<'a>> {
    TeamRead::new(view, filter, params, TeamReadTuning::DEFAULT).ok()
}

fn sql(mut builder: QueryBuilder<'static, Postgres>) -> String {
    builder.build().sql().to_string()
}

#[test]
fn reads_a_crm_record_across_contributing_inboxes() {
    let view = all_mail();
    let filter = any_direction("example.test");
    let read = team_read(&view, &filter, params(SimpleSortMethod::UpdatedAt)).unwrap();
    assert_eq!(read.inboxes, vec![OWN, TEAMMATE]);
}

#[test]
fn top_level_owner_narrows_the_inboxes() {
    let view = all_mail();
    let filter = signal_and_me(TEAMMATE);
    let read = team_read(&view, &filter, params(SimpleSortMethod::UpdatedAt)).unwrap();
    assert_eq!(read.inboxes, vec![TEAMMATE]);

    let filter = signal_and_me(NOT_CONTRIBUTING);
    let read = team_read(&view, &filter, params(SimpleSortMethod::UpdatedAt)).unwrap();
    assert!(read.inboxes.is_empty());
}

#[test]
fn leaves_other_requests_to_the_general_builder() {
    let filter = any_direction("example.test");
    let inbox = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    assert!(team_read(&inbox, &filter, params(SimpleSortMethod::UpdatedAt)).is_none());

    let view = all_mail();
    assert!(team_read(&view, &filter, params(SimpleSortMethod::ViewedAt)).is_none());

    let mut shared = params(SimpleSortMethod::UpdatedAt);
    shared.shared = SharedEmailFilter::Include;
    assert!(team_read(&view, &filter, shared).is_none());

    let mut personal = params(SimpleSortMethod::UpdatedAt);
    personal.team_id = None;
    assert!(team_read(&view, &filter, personal).is_none());

    let two_records = Expr::And(
        Box::new(any_direction("example.test")),
        Box::new(any_direction("other.test")),
    );
    assert!(team_read(&view, &two_records, params(SimpleSortMethod::UpdatedAt)).is_none());

    let no_addresses = Expr::Literal(EmailLiteral::Importance(true));
    assert!(team_read(&view, &no_addresses, params(SimpleSortMethod::UpdatedAt)).is_none());
}

#[test]
fn inbox_stream_walks_each_inbox_in_order() {
    let view = all_mail();
    let filter = any_direction("example.test");
    let read = team_read(&view, &filter, params(SimpleSortMethod::UpdatedAt)).unwrap();
    let page = sql(read.build_page(Stream::Inboxes));

    // One limited walk per inbox, merged, then the window.
    assert_eq!(
        page.matches("ORDER BY effective_ts DESC, id DESC LIMIT")
            .count(),
        2
    );
    assert!(page.contains(") AS inbox_threads"));
    assert!(!page.contains("matching_threads"));
    // The privacy rule is set-based, not a per-thread function call.
    assert!(!page.contains("crm_email_thread_allowed"));
    assert!(page.contains("contributing AS MATERIALIZED"));
    assert!(page.contains("team_blocked AS MATERIALIZED"));
    assert!(page.contains("personal_blocked AS MATERIALIZED"));
    // No cursor on the first page.
    assert!(!page.contains("::timestamptz, "));
}

#[test]
fn thread_terms_and_cursor_are_stream_conditions() {
    let view = all_mail();
    let filter = signal_and_me(OWN);
    let mut params = params(SimpleSortMethod::UpdatedAt);
    params.cursor_timestamp = Some(Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap());
    params.cursor_id_str = Some(Uuid::from_u128(9).to_string());
    let read = team_read(&view, &filter, params).unwrap();
    let page = sql(read.build_page(Stream::Superset));

    let stream = page
        .split(") AS stream")
        .next()
        .and_then(|head| head.rsplit("FROM email_threads t").next())
        .unwrap();
    assert!(stream.contains("t.id IN (SELECT thread_id FROM matching_threads)"));
    assert!(stream.contains("t.is_signal"));
    assert!(stream.contains("t.link_id = $"));
    assert!(stream.contains("(COALESCE(t.latest_non_spam_message_ts, t.updated_at), t.id) < ($"));
    assert!(page.contains("matching_threads AS MATERIALIZED"));
}

#[test]
fn probe_counts_the_superset_up_to_its_limit() {
    let view = all_mail();
    let filter = any_direction("example.test");
    let read = team_read(&view, &filter, params(SimpleSortMethod::UpdatedAt)).unwrap();
    let probe = sql(read.probe());
    assert!(probe.starts_with("WITH matching_contacts_0 AS MATERIALIZED"));
    assert!(probe.contains("UNION ALL"));
    assert!(probe.contains("SELECT count(*) FROM (SELECT 1 FROM ("));
    assert!(probe.ends_with(") AS capped"));
    // The superset skips the mailbox facts the page's checks apply.
    assert!(!probe.contains("email_message_mailbox_facts"));
}

/// A contact page's filter: its address in any direction.
fn contact(address: &str) -> Expr<EmailLiteral> {
    let email = || Email::Complete(EmailStr::parse_from_str(address).unwrap().into_owned());
    let literal = |make: fn(Email) -> EmailLiteral| Expr::Literal(make(email()));
    Expr::Or(
        Box::new(Expr::Or(
            Box::new(literal(EmailLiteral::Sender)),
            Box::new(literal(EmailLiteral::Cc)),
        )),
        Box::new(Expr::Or(
            Box::new(literal(EmailLiteral::Bcc)),
            Box::new(literal(EmailLiteral::Recipient)),
        )),
    )
}

fn superset_binds(read: &TeamRead<'_>, id: &Uuid) -> bool {
    read.superset
        .branches
        .iter()
        .any(|branch| branch.has_bind_uuid(id))
}

#[test]
fn superset_lists_only_the_inboxes_contacts() {
    let view = all_mail();
    let address = "p@example.test";
    let own = Uuid::from_u128(0xc1);
    let teammate = Uuid::from_u128(0xc2);
    let not_contributing = Uuid::from_u128(0xc3);
    let mut every = params(SimpleSortMethod::UpdatedAt);
    every.resolved = every
        .resolved
        .with_contact(address, own, OWN)
        .with_contact(address, teammate, TEAMMATE)
        .with_contact(address, not_contributing, NOT_CONTRIBUTING);
    let filter = contact(address);
    let read = team_read(&view, &filter, every).unwrap();
    assert!(superset_binds(&read, &own));
    assert!(superset_binds(&read, &teammate));
    assert!(!superset_binds(&read, &not_contributing));

    let mut two = params(SimpleSortMethod::UpdatedAt);
    two.resolved = two
        .resolved
        .with_contact(address, own, OWN)
        .with_contact(address, teammate, TEAMMATE);
    let me = Expr::And(
        Box::new(contact(address)),
        Box::new(Expr::Literal(EmailLiteral::Owner(OWN))),
    );
    let read = team_read(&view, &me, two).unwrap();
    assert!(superset_binds(&read, &own));
    assert!(!superset_binds(&read, &teammate));
}

#[test]
fn record_without_contacts_in_the_inboxes_has_no_superset() {
    let view = all_mail();
    let address = "p@example.test";
    let mut params = params(SimpleSortMethod::UpdatedAt);
    params.resolved =
        params
            .resolved
            .with_contact(address, Uuid::from_u128(0xc3), NOT_CONTRIBUTING);
    let filter = contact(address);
    let read = team_read(&view, &filter, params).unwrap();
    assert!(read.superset.branches.is_empty());
}

/// Link `i` of the `email_crm_team_read` fixture.
fn gamma_link(i: u128) -> Uuid {
    Uuid::from_u128(0xf000_0000_0000_0000_0000_0000_0000_0000 | i)
}

/// For every thread of the fixture: how many `crm_email_thread_allowed`
/// allows for `team`, how many get another verdict from the inline rule,
/// and how many there are. Every inbox of the fixture is offered, so the
/// `contributing` CTE's own mailbox conditions decide.
async fn verdicts(pool: &sqlx::PgPool, team: Uuid) -> anyhow::Result<(i64, i64, i64)> {
    let links: Vec<Uuid> = (0..=10).map(gamma_link).collect();
    let view = all_mail();
    let filter = any_direction("dense.test");
    let mut params = params(SimpleSortMethod::UpdatedAt);
    params.team_id = Some(team);
    params.resolved = ResolvedFilters::empty()
        .with_team_links(links.clone())
        .with_contributing_links(links);
    let read = team_read(&view, &filter, params).unwrap();

    let mut builder = QueryBuilder::new("");
    read.push_ctes(&mut builder, Stream::Inboxes);
    builder.push(
        r#"
        SELECT count(*) FILTER (WHERE allowed),
               count(*) FILTER (WHERE allowed IS DISTINCT FROM inline),
               count(*)
        FROM (
            SELECT crm_email_thread_allowed("#,
    );
    builder.push_bind(team);
    builder.push(", t.id) AS allowed, (TRUE");
    builder.push(ALLOWED);
    builder.push(") AS inline FROM email_threads t) AS verdict");
    Ok(builder.build_query_as().fetch_one(pool).await?)
}

/// Sorted contributing inboxes and member inboxes `resolve_filters` finds
/// for `caller`'s read in `team`.
async fn resolved_inboxes(
    pool: &sqlx::PgPool,
    team: Uuid,
    caller: Uuid,
) -> anyhow::Result<(Vec<Uuid>, Vec<Uuid>)> {
    let resolved =
        resolve_filters(pool, &[caller], Some(team), &any_direction("dense.test")).await?;
    let mut contributing = resolved.contributing_link_ids().unwrap().to_vec();
    contributing.sort();
    let mut members = resolved.team_link_ids().unwrap().to_vec();
    members.sort();
    Ok((contributing, members))
}

/// The inboxes a team read takes are the ones `crm_email_thread_allowed`
/// lets contribute. In Gamma each of these misses one of its mailbox
/// conditions: u5's primary inbox (link 6) has no consent of its own, since
/// u5's consent names u5's non-primary link 7; u6's inbox (link 8) is being
/// deleted; u7's (link 9) has consent off; and u3's (link 3) is named only by
/// u8's consent. Delta's u9 consents on link 10, which only Delta reads.
#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn contributing_inboxes_restate_the_privacy_function(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    let cases: [(&str, u128, Vec<u128>, Vec<u128>); 2] = [
        (GAMMA, 0, vec![0, 1, 2], vec![0, 1, 2, 3, 6, 8, 9]),
        (DELTA, 10, vec![10], vec![10]),
    ];
    for (team, caller, contributing_links, member_links) in cases {
        let team = Uuid::parse_str(team)?;
        let (contributing, members) = resolved_inboxes(&pool, team, gamma_link(caller)).await?;
        let allowed = sqlx::query_scalar!(
            r#"
            SELECT DISTINCT t.link_id AS "link_id!" FROM email_threads t
            WHERE crm_email_thread_allowed($1, t.id)
            ORDER BY 1
            "#,
            team,
        )
        .fetch_all(&pool)
        .await?;
        assert_eq!(contributing, allowed, "{team}");
        let expected: Vec<Uuid> = contributing_links.into_iter().map(gamma_link).collect();
        assert_eq!(allowed, expected, "{team}");
        // Every member's primary inbox, contributing or not.
        let expected: Vec<Uuid> = member_links.into_iter().map(gamma_link).collect();
        assert_eq!(members, expected, "{team}");
    }
    Ok(())
}

/// With one team per user (`team_user_user_id_unique`), another team's
/// consent and personal lists can't reach a team's read through its members,
/// so no valid data tests the read's own team conditions on them. This test
/// drops the constraint: u3, a Gamma member without Gamma consent, joins
/// Delta and consents there, and u1, who contributes to Gamma, joins Delta
/// and blocks dense.test there.
#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn another_teams_consent_and_lists_never_apply(pool: sqlx::PgPool) -> anyhow::Result<()> {
    let gamma = Uuid::parse_str(GAMMA)?;
    let delta = Uuid::parse_str(DELTA)?;
    sqlx::query!("ALTER TABLE team_user DROP CONSTRAINT team_user_user_id_unique")
        .execute(&pool)
        .await?;
    sqlx::query!(
        r#"
        INSERT INTO team_user (team_id, user_id, team_role)
        VALUES ($1, 'macro|u1@gamma.test', 'member'), ($1, 'macro|u3@gamma.test', 'member')
        "#,
        delta,
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO crm_email_consent (team_id, user_id, link_id, enabled)
        VALUES ($1, 'macro|u3@gamma.test', $2, TRUE)
        "#,
        delta,
        gamma_link(3),
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO crm_personal_email_blocklist (team_id, user_id, domain)
        VALUES ($1, 'macro|u1@gamma.test', 'dense.test')
        "#,
        delta,
    )
    .execute(&pool)
    .await?;

    // u3's Delta consent is live: Delta now reads u3's inbox.
    let (contributing, _) = resolved_inboxes(&pool, delta, gamma_link(10)).await?;
    assert_eq!(contributing, [3, 10].map(gamma_link));

    let (contributing, _) = resolved_inboxes(&pool, gamma, gamma_link(0)).await?;
    assert_eq!(contributing, [0, 1, 2].map(gamma_link));
    for team in [gamma, delta] {
        let (_, differ, total) = verdicts(&pool, team).await?;
        assert_eq!(
            differ, 0,
            "{team}: {differ} of {total} threads get another verdict"
        );
    }
    Ok(())
}

/// The inline privacy rule agrees with `crm_email_thread_allowed` on every
/// thread, for both teams. Some addresses sit at the edges of the suffix
/// test. The fixture's hand-made threads are where only a draft or a spam
/// message carries a participant.
#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../fixtures", scripts("email_crm_team_read"))
)]
async fn allowed_restates_the_privacy_function(pool: sqlx::PgPool) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        UPDATE email_contacts SET email_address = CASE email_address
            WHEN 'p0@other1.test' THEN 'p0@notblocked.test'
            WHEN 'p1@other1.test' THEN 'p1@Sub.BLOCKED.test'
            WHEN 'p2@other1.test' THEN 'p2@blocked.test.example'
            WHEN 'p0@other2.test' THEN 'no-at-sign'
            WHEN 'p1@other2.test' THEN 'p1@x..hidden.test'
            WHEN 'p2@other2.test' THEN 'p2@personal.test.'
        END
        WHERE email_address IN ('p0@other1.test', 'p1@other1.test', 'p2@other1.test',
                                'p0@other2.test', 'p1@other2.test', 'p2@other2.test')
        "#
    )
    .execute(&pool)
    .await?;

    let team = Uuid::parse_str(GAMMA)?;
    let hand_made = sqlx::query!(
        r#"
        SELECT t.provider_id AS "provider_id!", crm_email_thread_allowed($1, t.id) AS "allowed!"
        FROM email_threads t WHERE t.provider_id LIKE 'ph:%'
        ORDER BY 1
        "#,
        team,
    )
    .fetch_all(&pool)
    .await?;
    let hand_made: Vec<(&str, bool)> = hand_made
        .iter()
        .map(|thread| (thread.provider_id.as_str(), thread.allowed))
        .collect();
    assert_eq!(
        hand_made,
        [
            ("ph:blocked-draft", true),
            ("ph:blocked-spam", false),
            ("ph:blocked-spam-to", false),
            ("ph:dense-spam", true),
            ("ph:draft-only", false),
            ("ph:spam-and-draft", true),
        ]
    );

    let (allowed, differ, total) = verdicts(&pool, team).await?;
    assert_eq!(differ, 0, "{differ} of {total} threads get another verdict");
    assert!(
        allowed > 500 && allowed < total,
        "both verdicts occur: {allowed} of {total}"
    );

    // Delta reads only its own inbox, less what its blocklist and hidden
    // company cut.
    let (allowed, differ, total) = verdicts(&pool, Uuid::parse_str(DELTA)?).await?;
    assert_eq!(
        differ, 0,
        "Delta: {differ} of {total} threads get another verdict"
    );
    let delta_threads = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_threads WHERE link_id = $1"#,
        gamma_link(10),
    )
    .fetch_one(&pool)
    .await?;
    assert!(
        allowed > 100 && allowed < delta_threads,
        "Delta allows most of its inbox's threads: {allowed} of {delta_threads}"
    );
    Ok(())
}
