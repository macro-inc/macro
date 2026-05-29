//! DB-backed tests for CRM-scoped dynamic email queries.
//!
//! These exercise the candidate-set widening that fires when `team_id`
//! is `Some(_)` (the resolved CRM scope), plumbed from the soup/email
//! service down through `resolve_filters` and into the SQL
//! candidate-thread selection:
//!
//!   • `dynamic/query.rs::push_thread_candidate_select` — `Owned` source's
//!     `t.link_id = $link_id` swap to `t.link_id IN (links of team members)`
//!     when `team_id` is `Some`.
//!   • `dynamic/resolve.rs::resolve_filters` — contact_id resolution and
//!     TRASH label resolution expand from one link to all team links.
//!   • `dynamic/filters.rs::build_address_predicate_on_m` — emits
//!     `m.from_contact_id = ANY($ids)` so messages in any team member's
//!     mailbox match when the same address resolves to multiple contact
//!     UUIDs (one per link).
//!
//! Fixture: `email/fixtures/email_dynamic_query_crm_scope.sql`. Two team
//! members (Alice, Bob) and one non-member (Carol). Each link has its own
//! `email_contacts` row for `outsider@acme.com` and its own TRASH label
//! UUID — both of which the new ANY-based resolution must cover.

use super::*;
use macro_user_id::cowlike::CowLike;

// === Constants matching the fixture ===

const ALICE_LINK_ID: &str = "a0000001-0000-0000-0000-000000000001";
const TEAM_ALPHA_ID: &str = "e0000001-0000-0000-0000-000000000001";

// Thread ids in the fixture
const TA1_ALICE_INBOX_ACME: &str = "22220001-0000-0000-0000-000000000001";
const TA2_ALICE_TRASH_ACME: &str = "22220001-0000-0000-0000-000000000002";
const TA3_ALICE_INBOX_OTHER: &str = "22220001-0000-0000-0000-000000000003";
const TB1_BOB_INBOX_ACME: &str = "22220002-0000-0000-0000-000000000001";
const TB2_BOB_TRASH_ACME: &str = "22220002-0000-0000-0000-000000000002";
const TB3_BOB_INBOX_ONLYBOB: &str = "22220002-0000-0000-0000-000000000003";
const TC1_CAROL_INBOX_ACME: &str = "22220003-0000-0000-0000-000000000001";

fn complete(s: &str) -> Email {
    Email::Complete(EmailStr::parse_from_str(s).unwrap().into_owned())
}

/// Run a query and return the set of result thread-id strings.
async fn run_and_collect_ids(
    pool: &Pool<Postgres>,
    filter: Arc<Expr<EmailLiteral>>,
    team_id: Option<Uuid>,
) -> anyhow::Result<std::collections::HashSet<String>> {
    let link_id = Uuid::parse_str(ALICE_LINK_ID)?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 100;
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results = dynamic::dynamic_email_thread_cursor(
        pool,
        &[link_id],
        limit,
        &view,
        query,
        "macro|alice@team.com",
        team_id,
    )
    .await?;

    Ok(results.into_iter().map(|r| r.id.to_string()).collect())
}

// =====================================================================
// 1. Regression check: CRM scope OFF still only returns the caller's link.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_off_returns_only_callers_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Broad partial filter that matches both "outsider@acme.com" and
    // "other@elsewhere.com" (their email_address strings contain "com").
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "com".to_string(),
    ))));

    let ids = run_and_collect_ids(&pool, filter, None).await?;

    // Alice should see her two inbox threads (ta1, ta3). Her TRASH (ta2)
    // is excluded. No bob or carol threads.
    assert!(
        ids.contains(TA1_ALICE_INBOX_ACME),
        "alice's inbox acme thread should appear"
    );
    assert!(
        ids.contains(TA3_ALICE_INBOX_OTHER),
        "alice's inbox other thread should appear"
    );
    assert!(
        !ids.contains(TA2_ALICE_TRASH_ACME),
        "alice's TRASHED thread must not appear"
    );
    assert!(
        !ids.contains(TB1_BOB_INBOX_ACME),
        "bob's thread must not appear without CRM scope"
    );
    assert!(
        !ids.contains(TC1_CAROL_INBOX_ACME),
        "carol's thread must not appear"
    );
    assert_eq!(ids.len(), 2, "expected exactly 2 threads, got: {:?}", ids);

    Ok(())
}

// =====================================================================
// 2. CRM scope expands `Owned` to every team-member link.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_returns_all_team_member_threads(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    // Broad partial match — should hit every acme/elsewhere thread on team
    // links (alice + bob), TRASH excluded, carol excluded.
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "com".to_string(),
    ))));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    assert!(ids.contains(TA1_ALICE_INBOX_ACME));
    assert!(ids.contains(TA3_ALICE_INBOX_OTHER));
    assert!(ids.contains(TB1_BOB_INBOX_ACME));
    assert!(ids.contains(TB3_BOB_INBOX_ONLYBOB));
    assert!(
        !ids.contains(TA2_ALICE_TRASH_ACME),
        "alice's TRASHED must not appear"
    );
    assert!(
        !ids.contains(TB2_BOB_TRASH_ACME),
        "bob's TRASHED must not appear"
    );
    assert!(
        !ids.contains(TC1_CAROL_INBOX_ACME),
        "carol is not on the team"
    );
    assert_eq!(
        ids.len(),
        4,
        "expected 4 team-member inbox threads, got: {:?}",
        ids
    );

    Ok(())
}

// =====================================================================
// 3. CRM scope + `Sender(Domain(...))` filters across team links.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_with_domain_filter(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Domain(
        "acme.com".to_string(),
    ))));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    // Both alice's and bob's acme inbox threads — that's it.
    assert!(ids.contains(TA1_ALICE_INBOX_ACME));
    assert!(ids.contains(TB1_BOB_INBOX_ACME));
    assert!(
        !ids.contains(TA3_ALICE_INBOX_OTHER),
        "non-acme sender must not match"
    );
    assert!(!ids.contains(TA2_ALICE_TRASH_ACME), "alice TRASH excluded");
    assert!(!ids.contains(TB2_BOB_TRASH_ACME), "bob TRASH excluded");
    assert!(!ids.contains(TC1_CAROL_INBOX_ACME), "carol excluded");
    assert_eq!(ids.len(), 2, "expected 2 acme threads, got: {:?}", ids);

    Ok(())
}

// =====================================================================
// 4. CRM scope + `Sender(Complete(...))` resolves the address to ALL
//    matching contact_ids across team links, not just the caller's link.
//
//    This is the headline fix from option 2 — the same address has a
//    different contact_id in alice's link vs bob's link, and the predicate
//    must `= ANY($ids)` across both.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_with_complete_sender_resolves_across_links(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(complete(
        "outsider@acme.com",
    ))));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    // Bob's message references the bob_link contact_id, alice's message
    // references the alice_link contact_id. Both must match via ANY($ids).
    assert!(
        ids.contains(TA1_ALICE_INBOX_ACME),
        "alice's outsider@acme.com thread must match (alice_link contact_id)"
    );
    assert!(
        ids.contains(TB1_BOB_INBOX_ACME),
        "bob's outsider@acme.com thread must match (bob_link contact_id)"
    );
    assert!(
        !ids.contains(TA3_ALICE_INBOX_OTHER),
        "other@elsewhere.com is not outsider@acme.com"
    );
    assert!(!ids.contains(TA2_ALICE_TRASH_ACME), "alice TRASH excluded");
    assert!(!ids.contains(TB2_BOB_TRASH_ACME), "bob TRASH excluded");
    assert!(
        !ids.contains(TC1_CAROL_INBOX_ACME),
        "carol excluded — not on team"
    );
    assert_eq!(ids.len(), 2, "expected 2 threads, got: {:?}", ids);

    Ok(())
}

// =====================================================================
// 5. CRM scope's TRASH exclusion covers every team link's TRASH label.
//    Each link has a different TRASH label UUID; the multi-id ANY probe
//    must exclude trashed threads in every link, not just the caller's.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_excludes_trash_in_every_team_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    // Match all acme threads across team links.
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Domain(
        "acme.com".to_string(),
    ))));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    // ta2 (alice's TRASH) and tb2 (bob's TRASH) must NOT appear, even
    // though both message senders match the domain filter. Each link's
    // TRASH label has a different UUID — the test fails if the predicate
    // only excludes one link's TRASH ids.
    assert!(
        !ids.contains(TA2_ALICE_TRASH_ACME),
        "alice's TRASH excluded across team links"
    );
    assert!(
        !ids.contains(TB2_BOB_TRASH_ACME),
        "bob's TRASH excluded across team links"
    );
    // Sanity: the non-trashed acme threads still appear.
    assert!(ids.contains(TA1_ALICE_INBOX_ACME));
    assert!(ids.contains(TB1_BOB_INBOX_ACME));

    Ok(())
}

// =====================================================================
// 6. CRM scope short-circuits when the Complete address has no matching
//    contact in any team link (no rows in `contact_ids` map).
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_with_unknown_complete_sender_short_circuits(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    // Address not in any team link's email_contacts.
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(complete(
        "nobody@nowhere.com",
    ))));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    assert!(
        ids.is_empty(),
        "no team link has a contact row for nobody@nowhere.com, query must short-circuit; got: {:?}",
        ids
    );

    Ok(())
}

// =====================================================================
// 7. Caller is NOT on the team — but team_id is supplied anyway (e.g. a
//    test scaffold or buggy caller bypassing soup's 403 check). Defensive
//    check: the SQL still works, queries the team's mailboxes, and the
//    caller's own non-team threads do NOT bleed in.
//
//    Here we use carol's link_id as the caller — she's not on Team Alpha.
//    The Owned source resolves to team Alpha's links (alice + bob), so
//    carol's own thread (tc1) must NOT appear in the result.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_uses_team_mailboxes_not_caller_link(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let carol_link = Uuid::parse_str("a0000003-0000-0000-0000-000000000003")?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Domain(
        "acme.com".to_string(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results = dynamic::dynamic_email_thread_cursor(
        &pool,
        &[carol_link],
        100,
        &view,
        query,
        "macro|carol@team.com",
        Some(team_id),
    )
    .await?;
    let ids: std::collections::HashSet<String> =
        results.into_iter().map(|r| r.id.to_string()).collect();

    assert!(
        !ids.contains(TC1_CAROL_INBOX_ACME),
        "carol's own thread must not leak in"
    );
    assert!(
        ids.contains(TA1_ALICE_INBOX_ACME),
        "team's mailbox content is returned"
    );
    assert!(
        ids.contains(TB1_BOB_INBOX_ACME),
        "team's mailbox content is returned"
    );

    Ok(())
}

// =====================================================================
// 8. Recipient (TO) under CRM scope resolves across team links. The same
//    address has one `email_contacts` row per link (different UUIDs); the
//    `mr.contact_id = ANY($ids)` predicate must match the recipient row
//    that points at the per-link contact row.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_with_complete_recipient_resolves_across_links(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Recipient(complete(
        "to-target@elsewhere.com",
    ))));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    // ta1 and tb1 both have TO=to-target@elsewhere.com — but resolved to
    // different per-link contact UUIDs (c0000005 vs c0000008).
    assert!(ids.contains(TA1_ALICE_INBOX_ACME));
    assert!(ids.contains(TB1_BOB_INBOX_ACME));
    assert!(
        !ids.contains(TB3_BOB_INBOX_ONLYBOB),
        "tb3 has no recipient rows"
    );
    assert!(!ids.contains(TC1_CAROL_INBOX_ACME), "carol excluded");
    assert_eq!(ids.len(), 2, "expected 2 threads, got: {:?}", ids);

    Ok(())
}

// =====================================================================
// 9. CC across team links — same shape as #8 against the CC recipient_type.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_with_complete_cc_resolves_across_links(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Cc(complete(
        "cc-target@elsewhere.com",
    ))));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    assert!(ids.contains(TA1_ALICE_INBOX_ACME));
    assert!(ids.contains(TB1_BOB_INBOX_ACME));
    assert_eq!(ids.len(), 2, "expected 2 threads, got: {:?}", ids);

    Ok(())
}

// =====================================================================
// 10. BCC across team links — same shape, BCC recipient_type.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_with_complete_bcc_resolves_across_links(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Bcc(complete(
        "bcc-target@elsewhere.com",
    ))));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    assert!(ids.contains(TA1_ALICE_INBOX_ACME));
    assert!(ids.contains(TB1_BOB_INBOX_ACME));
    assert_eq!(ids.len(), 2, "expected 2 threads, got: {:?}", ids);

    Ok(())
}

// =====================================================================
// 11. NOT operator under CRM scope with an unresolved Complete sender.
//     `fold_unresolved` reduces the inner literal to `Some(false)`, then
//     `Not(Some(false)) -> Some(true)` — which is *not* a `Some(false)`
//     constant, so `can_short_circuit` returns false and the query runs.
//     The result should be every team-member inbox thread.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_not_unresolved_sender_does_not_short_circuit(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    // No team link has a contact row for nobody@nowhere.com, so the inner
    // literal folds to FALSE. NOT FALSE = TRUE — the query proceeds and
    // returns every team-member inbox thread that isn't TRASHED.
    let filter = Arc::new(Expr::is_not(Expr::Literal(EmailLiteral::Sender(complete(
        "nobody@nowhere.com",
    )))));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    assert!(ids.contains(TA1_ALICE_INBOX_ACME));
    assert!(ids.contains(TA3_ALICE_INBOX_OTHER));
    assert!(ids.contains(TB1_BOB_INBOX_ACME));
    assert!(ids.contains(TB3_BOB_INBOX_ONLYBOB));
    assert!(!ids.contains(TA2_ALICE_TRASH_ACME), "TRASH excluded");
    assert!(!ids.contains(TB2_BOB_TRASH_ACME), "TRASH excluded");
    assert!(!ids.contains(TC1_CAROL_INBOX_ACME), "carol excluded");
    assert_eq!(
        ids.len(),
        4,
        "NOT of unresolved should not short-circuit, got: {:?}",
        ids
    );

    Ok(())
}

// =====================================================================
// 12. Asymmetric contact rows: only Bob has `bob-only@onlybob.com` as a
//     contact. Resolution returns a single contact_id; the ANY($ids)
//     predicate with a 1-element array still matches correctly, and only
//     Bob's thread comes back.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_with_asymmetric_complete_sender(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(complete(
        "bob-only@onlybob.com",
    ))));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    assert!(ids.contains(TB3_BOB_INBOX_ONLYBOB));
    assert!(
        !ids.contains(TA1_ALICE_INBOX_ACME),
        "alice has no such contact"
    );
    assert!(!ids.contains(TB1_BOB_INBOX_ACME), "different sender");
    assert_eq!(ids.len(), 1, "expected exactly tb3, got: {:?}", ids);

    Ok(())
}

// =====================================================================
// 13. OR of one known and one unknown Complete sender. The unknown branch
//     folds to FALSE via `fold_unresolved`; the OR collapses to just the
//     known branch's results. Verifies short-circuit + multi-id ANY
//     resolution compose correctly under CRM scope.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_or_of_known_and_unknown_complete_senders(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let filter = Arc::new(Expr::or(
        Expr::Literal(EmailLiteral::Sender(complete("outsider@acme.com"))),
        Expr::Literal(EmailLiteral::Sender(complete("nobody@nowhere.com"))),
    ));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    // Known branch resolves to multi-id; unknown branch collapses to FALSE.
    // OR result = matches of the known branch.
    assert!(ids.contains(TA1_ALICE_INBOX_ACME));
    assert!(ids.contains(TB1_BOB_INBOX_ACME));
    assert!(
        !ids.contains(TB3_BOB_INBOX_ONLYBOB),
        "bob-only is a different address"
    );
    assert_eq!(ids.len(), 2, "expected 2 threads, got: {:?}", ids);

    Ok(())
}

// =====================================================================
// 14. Composed AND of two address kinds (Domain sender + Domain
//     recipient). Threads must satisfy BOTH constraints. Exercises the
//     intersection of the candidate-thread CTE pushdown across address
//     kinds under CRM scope.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_composed_and_sender_domain_and_recipient_domain(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let filter = Arc::new(Expr::and(
        Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".to_string()))),
        Expr::Literal(EmailLiteral::Recipient(Email::Domain(
            "elsewhere.com".to_string(),
        ))),
    ));

    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;

    // ta1 and tb1 both have sender@acme + TO=to-target@elsewhere.com.
    // tb3 is from bob-only@onlybob.com (sender doesn't match acme).
    // tc1 (carol) is excluded by team membership.
    // tb2 / ta2 are TRASHED.
    assert!(ids.contains(TA1_ALICE_INBOX_ACME));
    assert!(ids.contains(TB1_BOB_INBOX_ACME));
    assert!(!ids.contains(TB3_BOB_INBOX_ONLYBOB));
    assert!(!ids.contains(TC1_CAROL_INBOX_ACME));
    assert_eq!(ids.len(), 2, "expected 2 threads, got: {:?}", ids);

    Ok(())
}

// =====================================================================
// 15. Cursor-based pagination under CRM scope: result set spans multiple
//     team links. Page 1 + Page 2 must cover all 4 team-member inbox
//     threads with no overlap and no missing rows.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
async fn crm_scope_pagination_across_team_links(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    let link_id = Uuid::parse_str(ALICE_LINK_ID)?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 2;

    // Broad filter to hit all 4 team inbox threads.
    let filter_p1 = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "com".to_string(),
    ))));
    let query_p1 = Query::new(None, SimpleSortMethod::UpdatedAt, filter_p1);
    let page1 = dynamic::dynamic_email_thread_cursor(
        &pool,
        &[link_id],
        limit,
        &view,
        query_p1,
        "macro|alice@team.com",
        Some(team_id),
    )
    .await?;
    assert_eq!(
        page1.len(),
        2,
        "page 1 should be full, got: {}",
        page1.len()
    );

    // Cursor from the tail of page 1.
    let last = page1.last().unwrap();
    let cursor_ts = last.sort_ts;
    let cursor_id = last.id;
    let filter_p2 = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "com".to_string(),
    ))));
    let filter_p2_cursor = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Partial(
        "com".to_string(),
    ))));
    let cursor = Cursor {
        id: cursor_id,
        limit: limit as usize,
        val: CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: cursor_ts,
        },
        filter: filter_p2_cursor,
    };
    let query_p2 = Query::new(Some(cursor), SimpleSortMethod::UpdatedAt, filter_p2);
    let page2 = dynamic::dynamic_email_thread_cursor(
        &pool,
        &[link_id],
        limit,
        &view,
        query_p2,
        "macro|alice@team.com",
        Some(team_id),
    )
    .await?;

    // Union of pages must equal all 4 team-member inbox threads exactly.
    let mut all_ids: std::collections::HashSet<String> = std::collections::HashSet::new();
    for r in page1.iter().chain(page2.iter()) {
        assert!(
            all_ids.insert(r.id.to_string()),
            "page overlap on id {}",
            r.id
        );
    }
    assert!(all_ids.contains(TA1_ALICE_INBOX_ACME));
    assert!(all_ids.contains(TA3_ALICE_INBOX_OTHER));
    assert!(all_ids.contains(TB1_BOB_INBOX_ACME));
    assert!(all_ids.contains(TB3_BOB_INBOX_ONLYBOB));
    assert_eq!(
        all_ids.len(),
        4,
        "pages 1+2 must cover all 4 inbox threads, got: {:?}",
        all_ids
    );

    Ok(())
}

// 16. Killswitch race: if team_crm_settings.crm_enabled flips to FALSE
//     between the pre-check and the dynamic query, the candidate-source
//     JOIN drops every team link out of the candidate set. This is the
//     belt-and-suspenders gate; the typical entry point (validate_crm_scope)
//     would already reject the request with CrmDisabledForTeam, but this
//     test exercises the JOIN-level guard directly by calling the dynamic
//     query with team_id = Some after flipping the flag.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_scope")
    )
)]
#[allow(clippy::disallowed_methods, reason = "legacy code. fix later")]
async fn crm_scope_collapses_to_empty_when_killswitch_off(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_ALPHA_ID)?;
    // Flip the killswitch off after the fixture (which sets it ON).
    sqlx::query("UPDATE team_crm_settings SET crm_enabled = FALSE WHERE team_id = $1")
        .bind(team_id)
        .execute(&pool)
        .await?;

    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Domain(
        "acme.com".to_string(),
    ))));
    let ids = run_and_collect_ids(&pool, filter, Some(team_id)).await?;
    assert!(
        ids.is_empty(),
        "candidate set must be empty when crm_enabled = FALSE, got: {:?}",
        ids
    );
    Ok(())
}
