//! Tests for [`super::CrmSearchRepositoryImpl`] — CRM company name/domain
//! search and the batch enrich step, with their team-scoping and
//! hidden-visibility gates.
//!
//! Self-contained seed helpers: the `companies_repo` test helpers are
//! `pub(super)` to that module tree and not reachable here.

use super::{CrmSearchRepositoryImpl, escape_regex};
use crate::domain::search_repo::{CrmCompanySearchCursor, CrmSearchRepository};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

// --------------------------------------------------------------------------
// Seed helpers
// --------------------------------------------------------------------------

async fn seed_team(pool: &PgPool, team_id: Uuid, owner_id: &str) -> sqlx::Result<()> {
    let macro_user_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)"#,
    )
    .bind(macro_user_id)
    .bind(owner_id)
    .bind(owner_id)
    .bind(format!("stripe_{macro_user_id}"))
    .execute(pool)
    .await?;

    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#)
        .bind(owner_id)
        .bind(owner_id)
        .bind(macro_user_id)
        .execute(pool)
        .await?;

    sqlx::query(r#"INSERT INTO team (id, name, owner_id) VALUES ($1, $2, $3)"#)
        .bind(team_id)
        .bind("test team")
        .bind(owner_id)
        .execute(pool)
        .await?;

    Ok(())
}

/// Inserts a company with its domains. Each domain is a separate statement
/// (separate transaction) so `created_at` strictly increases in array order
/// — the first domain is the "primary" the directory join resolves against.
async fn insert_company(pool: &PgPool, team_id: Uuid, domains: &[&str]) -> sqlx::Result<Uuid> {
    let company_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO crm_companies (id, team_id, email_sync, first_interaction, last_interaction)
           VALUES ($1, $2, TRUE, now(), now())"#,
    )
    .bind(company_id)
    .bind(team_id)
    .execute(pool)
    .await?;

    for domain in domains {
        sqlx::query(r#"INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)"#)
            .bind(company_id)
            .bind(team_id)
            .bind(*domain)
            .execute(pool)
            .await?;
    }
    Ok(company_id)
}

async fn set_hidden(pool: &PgPool, company_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
        .execute(pool)
        .await?;
    Ok(())
}

async fn set_interaction(
    pool: &PgPool,
    company_id: Uuid,
    ts: chrono::DateTime<chrono::Utc>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"UPDATE crm_companies SET first_interaction = $2, last_interaction = $2 WHERE id = $1"#,
    )
    .bind(company_id)
    .bind(ts)
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_directory(
    pool: &PgPool,
    domain: &str,
    name: Option<&str>,
    description: Option<&str>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO crm_domain_directory (domain, name, description) VALUES ($1, $2, $3)"#,
    )
    .bind(domain)
    .bind(name)
    .bind(description)
    .execute(pool)
    .await?;
    Ok(())
}

fn ts(s: &str) -> chrono::DateTime<chrono::Utc> {
    s.parse().expect("valid timestamp")
}

// --------------------------------------------------------------------------
// escape_regex (pure, no DB)
// --------------------------------------------------------------------------

#[test]
fn escape_regex_escapes_metacharacters() {
    assert_eq!(escape_regex("c++"), r"c\+\+");
    assert_eq!(escape_regex("a.b*c"), r"a\.b\*c");
    assert_eq!(escape_regex("(x)[y]{z}"), r"\(x\)\[y\]\{z\}");
    assert_eq!(escape_regex(r"back\slash"), r"back\\slash");
    // Ordinary text is untouched.
    assert_eq!(escape_regex("acme"), "acme");
}

// --------------------------------------------------------------------------
// search_company_names — matching
// --------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_matches_by_directory_name(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let acme = insert_company(&pool, team, &["acme.com"]).await?;
    insert_directory(&pool, "acme.com", Some("Acme Inc."), None).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "acme", &[], None, false, 100, None)
        .await?;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, acme);
    assert_eq!(results[0].name, "Acme Inc.");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_matches_by_domain_when_no_directory(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let acme = insert_company(&pool, team, &["acme.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "acme", &[], None, false, 100, None)
        .await?;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, acme);
    // No directory row — display name falls back to the domain.
    assert_eq!(results[0].name, "acme.com");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_is_case_insensitive(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    insert_company(&pool, team, &["acme.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "ACME", &[], None, false, 100, None)
        .await?;
    assert_eq!(results.len(), 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_matches_substring(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    insert_company(&pool, team, &["acme.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "cme", &[], None, false, 100, None)
        .await?;
    assert_eq!(results.len(), 1);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_no_match_returns_empty(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    insert_company(&pool, team, &["acme.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "zzz", &[], None, false, 100, None)
        .await?;
    assert!(results.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_matches_secondary_domain_but_names_from_primary(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    // Primary acme.com (with directory), secondary globex.net (the match).
    let id = insert_company(&pool, team, &["acme.com", "globex.net"]).await?;
    insert_directory(&pool, "acme.com", Some("Acme Inc."), None).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "globex", &[], None, false, 100, None)
        .await?;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].id, id);
    // Matched via the secondary domain, but the display name resolves from
    // the primary (earliest-created) domain's directory entry.
    assert_eq!(results[0].name, "Acme Inc.");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_company_with_no_domains_never_matches(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    // Company with zero domains — the EXISTS(domains) guard excludes it.
    insert_company(&pool, team, &[]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "anything", &[], None, false, 100, None)
        .await?;
    assert!(results.is_empty());
    Ok(())
}

// --------------------------------------------------------------------------
// search_company_names — highlighting
// --------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_highlights_matched_span(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    insert_company(&pool, team, &["acme.com"]).await?;
    insert_directory(&pool, "acme.com", Some("Acme Inc."), None).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "acme", &[], None, false, 100, None)
        .await?;

    assert_eq!(results.len(), 1);
    // Case-insensitive match, original case preserved in the wrapped span.
    assert_eq!(
        results[0].name_highlighted,
        "<macro_em>Acme</macro_em> Inc."
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_escapes_regex_metacharacters_in_highlight(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    insert_company(&pool, team, &["cpp.com"]).await?;
    insert_directory(&pool, "cpp.com", Some("C++ Corp"), None).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "c++", &[], None, false, 100, None)
        .await?;

    assert_eq!(
        results.len(),
        1,
        "literal '++' must match, not blow up the regex"
    );
    assert_eq!(results[0].name_highlighted, "<macro_em>C++</macro_em> Corp");
    Ok(())
}

// --------------------------------------------------------------------------
// search_company_names — hidden visibility gate
// --------------------------------------------------------------------------

/// Seeds one visible + one hidden company, both matching the term "corp".
async fn seed_visible_and_hidden(pool: &PgPool, team: Uuid) -> sqlx::Result<(Uuid, Uuid)> {
    let visible = insert_company(pool, team, &["acme.com"]).await?;
    insert_directory(pool, "acme.com", Some("Acme Corp"), None).await?;
    let hidden = insert_company(pool, team, &["globex.com"]).await?;
    insert_directory(pool, "globex.com", Some("Globex Corp"), None).await?;
    set_hidden(pool, hidden).await?;
    Ok((visible, hidden))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_excludes_hidden_with_hidden_none(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let (visible, _hidden) = seed_visible_and_hidden(&pool, team).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "corp", &[], None, false, 100, None)
        .await?;
    let ids: Vec<Uuid> = results.iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![visible]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_visible_explicit_false_same_as_none(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let (visible, _hidden) = seed_visible_and_hidden(&pool, team).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "corp", &[], Some(false), false, 100, None)
        .await?;
    let ids: Vec<Uuid> = results.iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![visible]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_hidden_only_for_admin(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let (_visible, hidden) = seed_visible_and_hidden(&pool, team).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    // hidden=Some(true) + include_hidden (admin) → hidden rows only.
    let results = repo
        .search_company_names(&team, "corp", &[], Some(true), true, 100, None)
        .await?;
    let ids: Vec<Uuid> = results.iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![hidden]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_hidden_requested_by_member_returns_empty(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let (_visible, _hidden) = seed_visible_and_hidden(&pool, team).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    // hidden=Some(true) but NOT include_hidden (member) → no hidden rows leak.
    let results = repo
        .search_company_names(&team, "corp", &[], Some(true), false, 100, None)
        .await?;
    assert!(
        results.is_empty(),
        "a member must not be able to search the hidden set"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_active_tab_ignores_capability(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let (visible, _hidden) = seed_visible_and_hidden(&pool, team).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    // hidden=None even with the capability → still visible only.
    let results = repo
        .search_company_names(&team, "corp", &[], None, true, 100, None)
        .await?;
    let ids: Vec<Uuid> = results.iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![visible]);
    Ok(())
}

// --------------------------------------------------------------------------
// search_company_names — scoping
// --------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_scopes_to_team(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let a = insert_company(&pool, team_a, &["acme.com"]).await?;
    let _b = insert_company(&pool, team_b, &["acme.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team_a, "acme", &[], None, false, 100, None)
        .await?;
    let ids: Vec<Uuid> = results.iter().map(|m| m.id).collect();
    assert_eq!(
        ids,
        vec![a],
        "must not leak the other team's identically-named company"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_filters_by_company_ids_when_non_empty(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let wanted = insert_company(&pool, team, &["acme-one.com"]).await?;
    let _other = insert_company(&pool, team, &["acme-two.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "acme", &[wanted], None, false, 100, None)
        .await?;
    let ids: Vec<Uuid> = results.iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![wanted]);
    Ok(())
}

// --------------------------------------------------------------------------
// search_company_names — ordering, limit, pagination
// --------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_orders_by_interaction_desc(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let older = insert_company(&pool, team, &["acme1.com"]).await?;
    let newer = insert_company(&pool, team, &["acme2.com"]).await?;
    let newest = insert_company(&pool, team, &["acme3.com"]).await?;
    set_interaction(&pool, older, ts("2024-01-01T00:00:00Z")).await?;
    set_interaction(&pool, newer, ts("2024-01-02T00:00:00Z")).await?;
    set_interaction(&pool, newest, ts("2024-01-03T00:00:00Z")).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "acme", &[], None, false, 100, None)
        .await?;
    let ids: Vec<Uuid> = results.iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![newest, newer, older]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_respects_limit(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let a = insert_company(&pool, team, &["acme1.com"]).await?;
    let b = insert_company(&pool, team, &["acme2.com"]).await?;
    let c = insert_company(&pool, team, &["acme3.com"]).await?;
    set_interaction(&pool, a, ts("2024-01-01T00:00:00Z")).await?;
    set_interaction(&pool, b, ts("2024-01-02T00:00:00Z")).await?;
    set_interaction(&pool, c, ts("2024-01-03T00:00:00Z")).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .search_company_names(&team, "acme", &[], None, false, 2, None)
        .await?;
    let ids: Vec<Uuid> = results.iter().map(|m| m.id).collect();
    assert_eq!(ids, vec![c, b], "limit caps to the two newest");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_paginates_past_cursor(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;

    let mut companies = Vec::new();
    for day in 1..=5 {
        let domain = format!("acme{day}.com");
        let id = insert_company(&pool, team, &[domain.as_str()]).await?;
        set_interaction(&pool, id, ts(&format!("2024-01-0{day}T00:00:00Z"))).await?;
        companies.push(id);
    }
    let expected: Vec<Uuid> = companies.iter().rev().copied().collect();

    let repo = CrmSearchRepositoryImpl::new(pool);
    let mut seen: Vec<Uuid> = Vec::new();
    let mut cursor: Option<CrmCompanySearchCursor> = None;
    let mut first_page: Vec<Uuid> = Vec::new();
    for page_idx in 0..10 {
        let page = repo
            .search_company_names(&team, "acme", &[], None, false, 2, cursor)
            .await?;
        if page.is_empty() {
            break;
        }
        let page_ids: Vec<Uuid> = page.iter().map(|m| m.id).collect();
        if page_idx == 0 {
            first_page = page_ids.clone();
        } else {
            assert_ne!(
                page_ids, first_page,
                "cursor did not advance — page {page_idx} repeated the first page"
            );
        }
        let last = page.last().unwrap();
        cursor = Some(CrmCompanySearchCursor {
            last_updated_at: last.updated_at,
            last_id: last.id,
        });
        let exhausted = page.len() < 2;
        seen.extend(page_ids);
        if exhausted {
            break;
        }
    }

    assert_eq!(
        seen, expected,
        "pagination must yield every match exactly once in descending interaction order"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_pagination_breaks_ties_on_id(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;

    let newest = ts("2024-01-05T00:00:00Z");
    let tie = ts("2024-01-04T00:00:00Z");
    let mid = ts("2024-01-03T00:00:00Z");
    let oldest = ts("2024-01-02T00:00:00Z");

    let mut want: Vec<(chrono::DateTime<chrono::Utc>, Uuid)> = Vec::new();
    for (idx, t) in [newest, tie, tie, mid, oldest].into_iter().enumerate() {
        let domain = format!("acme{idx}.com");
        let id = insert_company(&pool, team, &[domain.as_str()]).await?;
        set_interaction(&pool, id, t).await?;
        want.push((t, id));
    }
    want.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let expected: Vec<Uuid> = want.iter().map(|(_, id)| *id).collect();

    let repo = CrmSearchRepositoryImpl::new(pool);
    let mut seen: Vec<Uuid> = Vec::new();
    let mut cursor: Option<CrmCompanySearchCursor> = None;
    for _ in 0..10 {
        let page = repo
            .search_company_names(&team, "acme", &[], None, false, 2, cursor)
            .await?;
        if page.is_empty() {
            break;
        }
        let last = page.last().unwrap();
        cursor = Some(CrmCompanySearchCursor {
            last_updated_at: last.updated_at,
            last_id: last.id,
        });
        let exhausted = page.len() < 2;
        seen.extend(page.iter().map(|m| m.id));
        if exhausted {
            break;
        }
    }

    assert_eq!(
        seen, expected,
        "tied timestamps must paginate by id without skipping or repeating"
    );
    Ok(())
}

// --------------------------------------------------------------------------
// enrich_companies — hydration
// --------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_hydrates_name_description_and_domains(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let id = insert_company(&pool, team, &["acme.com", "acmecorp.com"]).await?;
    insert_directory(&pool, "acme.com", Some("Acme Inc."), Some("Rocket skates.")).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo.enrich_companies(&team, &[id], false).await?;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].company.id, id);
    assert_eq!(results[0].name.as_deref(), Some("Acme Inc."));
    assert_eq!(results[0].description.as_deref(), Some("Rocket skates."));
    assert_eq!(results[0].company.domains.len(), 2);
    assert_eq!(results[0].company.domains[0].domain, "acme.com");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_uses_primary_domain_for_directory(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    // Directory only on the SECONDARY domain — must not be picked.
    let id = insert_company(&pool, team, &["acme.com", "globex.net"]).await?;
    insert_directory(&pool, "globex.net", Some("Globex"), Some("nope")).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo.enrich_companies(&team, &[id], false).await?;

    assert_eq!(results.len(), 1);
    assert_eq!(
        results[0].name, None,
        "name must come from the primary domain only"
    );
    assert_eq!(results[0].description, None);
    assert_eq!(results[0].company.domains.len(), 2);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_negative_cache_directory_yields_none(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let id = insert_company(&pool, team, &["acme.com"]).await?;
    insert_directory(&pool, "acme.com", None, None).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo.enrich_companies(&team, &[id], false).await?;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].name, None);
    assert_eq!(results[0].description, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_no_directory_yields_none_but_hydrates_domains(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let id = insert_company(&pool, team, &["acme.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo.enrich_companies(&team, &[id], false).await?;

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].name, None);
    assert_eq!(results[0].company.domains.len(), 1);
    assert_eq!(results[0].company.domains[0].domain, "acme.com");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_company_with_no_domains(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let id = insert_company(&pool, team, &[]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo.enrich_companies(&team, &[id], false).await?;

    assert_eq!(results.len(), 1, "a domainless company is still returned");
    assert!(results[0].company.domains.is_empty());
    assert_eq!(results[0].name, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_domains_ordered_by_created_at(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let id = insert_company(&pool, team, &["a.com", "b.com", "c.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo.enrich_companies(&team, &[id], false).await?;

    let domains: Vec<String> = results[0]
        .company
        .domains
        .iter()
        .map(|d| d.domain.clone())
        .collect();
    assert_eq!(domains, vec!["a.com", "b.com", "c.com"]);
    Ok(())
}

// --------------------------------------------------------------------------
// enrich_companies — filtering, scoping, hidden gate
// --------------------------------------------------------------------------

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_filters_by_company_ids(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let wanted = insert_company(&pool, team, &["acme.com"]).await?;
    let _other = insert_company(&pool, team, &["globex.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo.enrich_companies(&team, &[wanted], false).await?;
    let ids: Vec<Uuid> = results.iter().map(|c| c.company.id).collect();
    assert_eq!(ids, vec![wanted]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_scopes_to_team(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    let b_company = insert_company(&pool, team_b, &["acme.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    // Ask team_a to enrich team_b's id → silently dropped.
    let results = repo.enrich_companies(&team_a, &[b_company], false).await?;
    assert!(results.is_empty());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_member_cannot_enrich_hidden(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let hidden = insert_company(&pool, team, &["acme.com"]).await?;
    set_hidden(&pool, hidden).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    // Member passes the hidden id directly — must still get nothing.
    let results = repo.enrich_companies(&team, &[hidden], false).await?;
    assert!(
        results.is_empty(),
        "a member must not be able to enrich a hidden company even with its id"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_admin_can_enrich_hidden(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let hidden = insert_company(&pool, team, &["acme.com"]).await?;
    set_hidden(&pool, hidden).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo.enrich_companies(&team, &[hidden], true).await?;
    let ids: Vec<Uuid> = results.iter().map(|c| c.company.id).collect();
    assert_eq!(ids, vec![hidden]);
    assert!(results[0].company.hidden);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_member_gets_only_visible_from_mixed_ids(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let visible = insert_company(&pool, team, &["acme.com"]).await?;
    let hidden = insert_company(&pool, team, &["globex.com"]).await?;
    set_hidden(&pool, hidden).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo
        .enrich_companies(&team, &[visible, hidden], false)
        .await?;
    let ids: Vec<Uuid> = results.iter().map(|c| c.company.id).collect();
    assert_eq!(ids, vec![visible], "hidden id is dropped, visible kept");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn enrich_returns_all_requested_visible_companies(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|o@test.com").await?;
    let a = insert_company(&pool, team, &["a.com"]).await?;
    let b = insert_company(&pool, team, &["b.com"]).await?;
    let c = insert_company(&pool, team, &["c.com"]).await?;

    let repo = CrmSearchRepositoryImpl::new(pool);
    let results = repo.enrich_companies(&team, &[a, b, c], false).await?;
    let mut ids: Vec<Uuid> = results.iter().map(|r| r.company.id).collect();
    ids.sort();
    let mut want = vec![a, b, c];
    want.sort();
    assert_eq!(
        ids, want,
        "every requested visible company is hydrated once"
    );
    Ok(())
}
