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

// =====================================================================
// Dedupe of team-member conversation copies — fixture
// `email_dynamic_query_crm_dedupe.sql`. Two members (Dave, Erin) and
// four conversations keyed by root-message global_id:
//   X — both copies; dave's is newer (extra reply).
//   Y — erin only.   Z — dave only.
//   W — both copies; ERIN's is newer (extra reply).
// =====================================================================

const TEAM_BETA_ID: &str = "e0000002-0000-0000-0000-000000000002";
const DAVE_LINK_ID: &str = "d0000001-0000-0000-0000-000000000001";
const ERIN_LINK_ID: &str = "d0000002-0000-0000-0000-000000000002";

const TD1_DAVE_CONV_X: &str = "55550001-0000-0000-0000-000000000001";
const TD2_DAVE_CONV_Z: &str = "55550001-0000-0000-0000-000000000002";
const TD3_DAVE_CONV_W: &str = "55550001-0000-0000-0000-000000000003";
const TE1_ERIN_CONV_X: &str = "55550002-0000-0000-0000-000000000001";
const TE2_ERIN_CONV_Y: &str = "55550002-0000-0000-0000-000000000002";
const TE3_ERIN_CONV_W: &str = "55550002-0000-0000-0000-000000000003";

/// Run a team-scoped acme.com query for one caller and return the result
/// thread ids in order.
async fn run_dedupe_query(
    pool: &Pool<Postgres>,
    caller_link: &str,
    caller_user: &str,
) -> anyhow::Result<Vec<String>> {
    let team_id = Uuid::parse_str(TEAM_BETA_ID)?;
    let link_id = Uuid::parse_str(caller_link)?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let filter = Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Domain(
        "acme.com".to_string(),
    ))));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results = dynamic::dynamic_email_thread_cursor(
        pool,
        &[link_id],
        100,
        &view,
        query,
        caller_user,
        Some(team_id),
    )
    .await?;
    Ok(results.into_iter().map(|r| r.id.to_string()).collect())
}

// =====================================================================
// 17. One row per conversation; the caller's own copy wins even when the
//     teammate's copy is newer (W), and teammate-only conversations come
//     back via the teammate's copy (Y).
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_dedupe")
    )
)]
async fn crm_scope_dedupes_team_copies_own_copy_wins(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let ids = run_dedupe_query(&pool, DAVE_LINK_ID, "macro|dave@beta.com").await?;

    // Ordered by the representative's recency: Z(11) > X(10) > Y(9) > W(7).
    // X: dave's copy (own + newer). W: dave's copy despite erin's being
    // newer — own-copy preference precedes recency. Y: erin's copy (dave
    // has none).
    assert_eq!(
        ids,
        vec![
            TD2_DAVE_CONV_Z.to_string(),
            TD1_DAVE_CONV_X.to_string(),
            TE2_ERIN_CONV_Y.to_string(),
            TD3_DAVE_CONV_W.to_string(),
        ],
        "expected one row per conversation with dave's copies preferred"
    );

    Ok(())
}

// =====================================================================
// 18. Same fixture from Erin's perspective — symmetric preference. Erin
//     gets her own X copy even though Dave's is newer.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_dedupe")
    )
)]
async fn crm_scope_dedupe_is_caller_relative(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let ids = run_dedupe_query(&pool, ERIN_LINK_ID, "macro|erin@beta.com").await?;

    // W(12, erin's own) > Z(11, dave-only) > Y(9, own) > X(8, erin's own
    // copy even though dave's is at 10:00).
    assert_eq!(
        ids,
        vec![
            TE3_ERIN_CONV_W.to_string(),
            TD2_DAVE_CONV_Z.to_string(),
            TE2_ERIN_CONV_Y.to_string(),
            TE1_ERIN_CONV_X.to_string(),
        ],
        "expected one row per conversation with erin's copies preferred"
    );

    Ok(())
}

// =====================================================================
// 19. Dedupe is stable across cursor pages. The representative is chosen
//     before the cursor applies, so a conversation whose non-preferred
//     copy falls into a later page window must NOT resurface. With the
//     cursor inside the dedupe (the naive shape), erin's X copy (08:00)
//     would leak onto the page after dave's X copy (10:00) was returned.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_dedupe")
    )
)]
async fn crm_scope_dedupe_stable_across_cursor_pages(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let team_id = Uuid::parse_str(TEAM_BETA_ID)?;
    let link_id = Uuid::parse_str(DAVE_LINK_ID)?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let limit = 1;
    let make_filter = || {
        Arc::new(Expr::Literal(EmailLiteral::Sender(Email::Domain(
            "acme.com".to_string(),
        ))))
    };

    let mut pages: Vec<String> = Vec::new();
    let mut cursor: Option<Cursor<Uuid, CursorVal<SimpleSortMethod>, Arc<Expr<EmailLiteral>>>> =
        None;
    loop {
        let query = Query::new(cursor.take(), SimpleSortMethod::UpdatedAt, make_filter());
        let page = dynamic::dynamic_email_thread_cursor(
            &pool,
            &[link_id],
            limit,
            &view,
            query,
            "macro|dave@beta.com",
            Some(team_id),
        )
        .await?;
        let Some(last) = page.last() else {
            break;
        };
        cursor = Some(Cursor {
            id: last.id,
            limit: limit as usize,
            val: CursorVal {
                sort_type: SimpleSortMethod::UpdatedAt,
                last_val: last.sort_ts,
            },
            filter: make_filter(),
        });
        pages.extend(page.into_iter().map(|r| r.id.to_string()));
        assert!(pages.len() <= 6, "runaway pagination: {:?}", pages);
    }

    // Every conversation exactly once, own copies preferred, and neither
    // of erin's duplicate copies (te1, te3) ever surfaces on any page.
    assert_eq!(
        pages,
        vec![
            TD2_DAVE_CONV_Z.to_string(),
            TD1_DAVE_CONV_X.to_string(),
            TE2_ERIN_CONV_Y.to_string(),
            TD3_DAVE_CONV_W.to_string(),
        ],
        "pages must cover each conversation exactly once with no duplicate copies"
    );

    Ok(())
}

// =====================================================================
// 20. Root selection skips drafts. Dave's X copy contains a draft that
//     is the EARLIEST message in the thread and has a (mailbox-local)
//     global_id. If the root subquery didn't filter `is_draft = FALSE`,
//     dave's key would become the draft's Message-ID and X would stop
//     deduping (te1 would reappear). Covered implicitly by #17's exact
//     vector; this test names the intent.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts("email_dynamic_query_crm_dedupe")
    )
)]
async fn crm_scope_dedupe_root_skips_drafts(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let ids = run_dedupe_query(&pool, DAVE_LINK_ID, "macro|dave@beta.com").await?;

    assert!(
        ids.contains(&TD1_DAVE_CONV_X.to_string()),
        "dave's X copy must be the representative"
    );
    assert!(
        !ids.contains(&TE1_ERIN_CONV_X.to_string()),
        "X must still dedupe — the gid-less draft must not become the root"
    );

    Ok(())
}

// =====================================================================
// 21. A copy shared from OUTSIDE the team (entity_access) collapses with
//     the caller's own copy. Faye (non-member) has a copy of X — the
//     newest of all X copies — directly shared with Dave. Under
//     Shared::Include it enters via the Shared candidate branch and must
//     dedupe into td1; a failure would put tf1 at the top of the list.
// =====================================================================

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../fixtures",
        scripts(
            "email_dynamic_query_crm_dedupe",
            "email_dynamic_query_crm_dedupe_shared"
        )
    )
)]
async fn crm_scope_dedupe_collapses_externally_shared_copy(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const TF1_FAYE_CONV_X: &str = "55550003-0000-0000-0000-000000000001";

    let team_id = Uuid::parse_str(TEAM_BETA_ID)?;
    let link_id = Uuid::parse_str(DAVE_LINK_ID)?;
    let view = PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox);
    let filter = Arc::new(Expr::and(
        Expr::Literal(EmailLiteral::Sender(Email::Domain("acme.com".to_string()))),
        Expr::Literal(EmailLiteral::Shared(
            item_filters::SharedEmailFilter::Include,
        )),
    ));
    let query = Query::new(None, SimpleSortMethod::UpdatedAt, filter);

    let results = dynamic::dynamic_email_thread_cursor(
        &pool,
        &[link_id],
        100,
        &view,
        query,
        "macro|dave@beta.com",
        Some(team_id),
    )
    .await?;
    let ids: Vec<String> = results.into_iter().map(|r| r.id.to_string()).collect();

    // Same vector as #17 — faye's tf1 entered via the Shared branch but
    // collapsed into dave's own X copy.
    assert_eq!(
        ids,
        vec![
            TD2_DAVE_CONV_Z.to_string(),
            TD1_DAVE_CONV_X.to_string(),
            TE2_ERIN_CONV_Y.to_string(),
            TD3_DAVE_CONV_W.to_string(),
        ],
        "externally shared copy must dedupe into the caller's own copy"
    );
    assert!(!ids.contains(&TF1_FAYE_CONV_X.to_string()));

    Ok(())
}

// =====================================================================
// 22. Documented degradation: a member added MID-THREAD has a copy
//     without the root message, so root-by-date keys diverge and both
//     copies are returned. If the dedupe key strategy ever changes,
//     update this test alongside it.
// =====================================================================

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
async fn crm_scope_dedupe_mid_thread_join_copies_stay_separate(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    const TDV_DAVE_CONV_V: &str = "55550001-0000-0000-0000-000000000004";
    const TEV_ERIN_CONV_V: &str = "55550002-0000-0000-0000-000000000004";

    let ids = run_dedupe_query(&pool, DAVE_LINK_ID, "macro|dave@beta.com").await?;

    // Dave's V copy lacks the root '<v-1@...>' message — its key is
    // '<v-2@...>' while erin's is '<v-1@...>', so both rows survive.
    assert!(ids.contains(&TDV_DAVE_CONV_V.to_string()));
    assert!(ids.contains(&TEV_ERIN_CONV_V.to_string()));
    assert_eq!(
        ids.len(),
        6,
        "X/Y/Z/W dedupe as usual plus both divergent V copies, got: {:?}",
        ids
    );

    Ok(())
}
