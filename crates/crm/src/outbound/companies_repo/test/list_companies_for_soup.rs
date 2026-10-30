use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::domain::model::CrmCompanyForSoup;
use crate::outbound::companies_repo::*;
use chrono::{DateTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

const VIEWER: &str = "macro|viewer@test.com";
const CRM_COMPANY: &str = "crm_company";
const ALL_SORTS: [CrmCompanyListSort; 4] = [
    CrmCompanyListSort::UpdatedAt,
    CrmCompanyListSort::CreatedAt,
    CrmCompanyListSort::ViewedAt,
    CrmCompanyListSort::ViewedUpdated,
];

/// Whole hours, so the values survive `UserHistory`'s millisecond
/// timestamps and the cursor compare unchanged.
fn ts(day: u32, hour: u32) -> DateTime<Utc> {
    format!("2024-01-{day:02}T{hour:02}:00:00Z")
        .parse()
        .expect("valid RFC 3339 timestamp")
}

fn ids(page: &[CrmCompanyForSoup]) -> Vec<Uuid> {
    page.iter().map(|c| c.company.id).collect()
}

async fn insert_company_at(
    pool: &PgPool,
    team_id: Uuid,
    domain: &str,
    first_interaction: DateTime<Utc>,
    last_interaction: DateTime<Utc>,
) -> sqlx::Result<Uuid> {
    let id = insert_company(pool, team_id, true, &[domain]).await?;
    sqlx::query(
        r#"UPDATE crm_companies
           SET first_interaction = $2, last_interaction = $3
           WHERE id = $1"#,
    )
    .bind(id)
    .bind(first_interaction)
    .bind(last_interaction)
    .execute(pool)
    .await?;
    Ok(id)
}

async fn record_history(
    pool: &PgPool,
    user_id: &str,
    item_type: &str,
    item_id: Uuid,
    at: DateTime<Utc>,
) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $4)"#,
    )
    .bind(user_id)
    .bind(item_id.to_string())
    .bind(item_type)
    .bind(at)
    .execute(pool)
    .await?;
    Ok(())
}

/// Pages through `VIEWER`'s list the way the soup paginator does: each
/// cursor is the last row's sort timestamp (`SoupItem::cursor_timestamp`)
/// and id.
async fn walk(
    repo: &CompaniesRepositoryImpl,
    team: &Uuid,
    sort: CrmCompanyListSort,
    limit: i64,
) -> anyhow::Result<Vec<Uuid>> {
    let mut seen = Vec::new();
    let mut cursor = None;
    for _ in 0..20 {
        let page = repo
            .list_companies_for_soup(team, VIEWER, &[], None, sort, cursor, limit)
            .await?;
        seen.extend(ids(&page));
        let Some(last) = page.last() else {
            break;
        };
        if i64::try_from(page.len())? < limit {
            break;
        }
        let last_sort_ts = match sort {
            CrmCompanyListSort::UpdatedAt => last.company.updated_at,
            CrmCompanyListSort::CreatedAt => last.company.created_at,
            CrmCompanyListSort::ViewedAt => last.viewed_at.unwrap_or_default(),
            CrmCompanyListSort::ViewedUpdated => last.viewed_at.unwrap_or(last.company.updated_at),
        };
        cursor = Some(CrmCompanySoupCursor {
            last_sort_ts,
            last_id: last.company.id,
        });
    }
    Ok(seen)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_returns_empty_when_killswitch_missing(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    // No team_crm_settings row → killswitch defaults to off.
    insert_company(&pool, team, true, &["acme.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(
            &team,
            "macro|owner@test.com",
            &[],
            None,
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    assert!(
        result.is_empty(),
        "killswitch missing must short-circuit to empty list even when companies exist"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_returns_empty_when_killswitch_off(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    sqlx::query(r#"INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, FALSE)"#)
        .bind(team)
        .execute(&pool)
        .await?;
    let viewed = insert_company(&pool, team, true, &["acme.com"]).await?;
    insert_company(&pool, team, true, &["zeta.com"]).await?;
    record_history(&pool, owner, CRM_COMPANY, viewed, ts(1, 0)).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    for sort in ALL_SORTS {
        let result = repo
            .list_companies_for_soup(&team, owner, &[], None, sort, None, 100)
            .await?;
        assert!(result.is_empty(), "{sort:?}");
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_excludes_hidden_rows(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    let visible = insert_company(&pool, team, true, &["acme.com"]).await?;
    let hidden = insert_company(&pool, team, true, &["zeta.com"]).await?;
    sqlx::query("UPDATE crm_companies SET hidden = TRUE WHERE id = $1")
        .bind(hidden)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(
            &team,
            "macro|owner@test.com",
            &[],
            None,
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    let ids: Vec<Uuid> = result.iter().map(|c| c.company.id).collect();
    assert_eq!(ids, vec![visible], "hidden = TRUE rows must not appear");
    // The visible row must have its domains hydrated.
    assert_eq!(result[0].company.domains.len(), 1);
    assert_eq!(result[0].company.domains[0].domain, "acme.com");
    // No directory row for acme.com — both display fields should be None.
    assert_eq!(result[0].name, None);
    assert_eq!(result[0].description, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_returns_hidden_when_hidden_true(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    let visible = insert_company(&pool, team, true, &["acme.com"]).await?;
    let hidden = insert_company(&pool, team, true, &["zeta.com"]).await?;
    sqlx::query("UPDATE crm_companies SET hidden = TRUE WHERE id = $1")
        .bind(hidden)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool);

    let hidden_only = repo
        .list_companies_for_soup(
            &team,
            "macro|owner@test.com",
            &[],
            Some(true),
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    let ids: Vec<Uuid> = hidden_only.iter().map(|c| c.company.id).collect();
    assert_eq!(
        ids,
        vec![hidden],
        "hidden=Some(true) must return only hidden rows"
    );

    let visible_only_explicit = repo
        .list_companies_for_soup(
            &team,
            "macro|owner@test.com",
            &[],
            Some(false),
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    let ids: Vec<Uuid> = visible_only_explicit.iter().map(|c| c.company.id).collect();
    assert_eq!(
        ids,
        vec![visible],
        "hidden=Some(false) must behave the same as None (visible only)",
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_hydrates_name_and_description_from_directory(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    insert_company(&pool, team, true, &["acme.com", "acmecorp.com"]).await?;
    // Directory row only on the primary — secondary must not be picked.
    sqlx::query(
        r#"INSERT INTO crm_domain_directory (domain, name, description)
           VALUES ($1, $2, $3)"#,
    )
    .bind("acme.com")
    .bind("Acme Inc.")
    .bind("Maker of rocket-powered roller skates.")
    .execute(&pool)
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(
            &team,
            "macro|owner@test.com",
            &[],
            None,
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].name.as_deref(), Some("Acme Inc."));
    assert_eq!(
        result[0].description.as_deref(),
        Some("Maker of rocket-powered roller skates.")
    );
    // Domain order is by created_at ASC; both should be present.
    assert_eq!(result[0].company.domains.len(), 2);
    assert_eq!(result[0].company.domains[0].domain, "acme.com");
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_returns_none_for_negative_cache_directory_row(
    pool: PgPool,
) -> anyhow::Result<()> {
    // Negative-cache directory row (NULL name/description) → soup
    // surfaces as None, not Some("").
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    insert_company(&pool, team, true, &["acme.com"]).await?;
    sqlx::query(
        r#"INSERT INTO crm_domain_directory (domain, name, description)
           VALUES ($1, NULL, NULL)"#,
    )
    .bind("acme.com")
    .execute(&pool)
    .await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(
            &team,
            "macro|owner@test.com",
            &[],
            None,
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].name, None);
    assert_eq!(result[0].description, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_filters_by_company_ids_when_non_empty(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let owner = "macro|owner@test.com";
    seed_team(&pool, team, owner).await?;
    enable_crm_for_team(&pool, team).await?;
    let wanted = insert_company(&pool, team, true, &["acme.com"]).await?;
    let _other = insert_company(&pool, team, true, &["zeta.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(
            &team,
            "macro|owner@test.com",
            &[wanted],
            None,
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    let ids: Vec<Uuid> = result.iter().map(|c| c.company.id).collect();
    assert_eq!(ids, vec![wanted]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_does_not_leak_other_team_rows(pool: PgPool) -> anyhow::Result<()> {
    let team_a = Uuid::now_v7();
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_a, "macro|a@test.com").await?;
    seed_team(&pool, team_b, "macro|b@test.com").await?;
    enable_crm_for_team(&pool, team_a).await?;
    enable_crm_for_team(&pool, team_b).await?;
    insert_company(&pool, team_a, true, &["acme.com"]).await?;
    let b_only = insert_company(&pool, team_b, true, &["zeta.com"]).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let result = repo
        .list_companies_for_soup(
            &team_b,
            "macro|b@test.com",
            &[],
            None,
            CrmCompanyListSort::UpdatedAt,
            None,
            100,
        )
        .await?;
    let ids: Vec<Uuid> = result.iter().map(|c| c.company.id).collect();
    assert_eq!(ids, vec![b_only]);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_paginates_past_cursor(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team).await?;

    // Five companies with strictly increasing interaction timestamps.
    // Parsed (not `now()`) so they carry no sub-microsecond precision
    // that Postgres would truncate out from under the cursor compare.
    let mut companies = Vec::new();
    for day in 1..=5 {
        let domain = format!("c{day}.com");
        let id = insert_company(&pool, team, true, &[domain.as_str()]).await?;
        let ts: chrono::DateTime<chrono::Utc> = format!("2024-01-0{day}T00:00:00Z").parse()?;
        sqlx::query(
            r#"UPDATE crm_companies
               SET first_interaction = $2, last_interaction = $2
               WHERE id = $1"#,
        )
        .bind(id)
        .bind(ts)
        .execute(&pool)
        .await?;
        companies.push(id);
    }
    // Descending by timestamp → newest (day 5) first.
    let expected: Vec<Uuid> = companies.iter().rev().copied().collect();

    let repo = CompaniesRepositoryImpl::new(pool);

    // Walk every page with limit=2, threading the keyset cursor from the
    // last row of each page — exactly how the soup paginator drives it.
    let mut seen: Vec<Uuid> = Vec::new();
    let mut cursor: Option<CrmCompanySoupCursor> = None;
    let mut first_page: Vec<Uuid> = Vec::new();
    for page_idx in 0..10 {
        let page = repo
            .list_companies_for_soup(
                &team,
                "macro|owner@test.com",
                &[],
                None,
                CrmCompanyListSort::UpdatedAt,
                cursor,
                2,
            )
            .await?;
        if page.is_empty() {
            break;
        }
        let page_ids: Vec<Uuid> = page.iter().map(|c| c.company.id).collect();
        if page_idx == 0 {
            first_page = page_ids.clone();
        } else {
            // Regression: a follow-up page must not re-serve page one.
            // (The pre-fix query ignored the cursor and always did this.)
            assert_ne!(
                page_ids, first_page,
                "cursor did not advance — page {page_idx} repeated the first page"
            );
        }
        let last = page.last().unwrap();
        cursor = Some(CrmCompanySoupCursor {
            last_sort_ts: last.company.updated_at,
            last_id: last.company.id,
        });
        let exhausted = page.len() < 2;
        seen.extend(page_ids);
        if exhausted {
            break;
        }
    }

    assert_eq!(
        seen, expected,
        "pagination must yield every company exactly once in descending interaction order"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_pagination_breaks_ties_on_id(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, "macro|owner@test.com").await?;
    enable_crm_for_team(&pool, team).await?;

    // One newest company, then a tied pair, then two older. At limit=2
    // the tied pair straddles the page-1/page-2 boundary, so pagination
    // must lean on the `id` half of the keyset — a timestamp-only seek
    // would skip the second tied row (its ts is not `< cursor_ts`).
    let newest: chrono::DateTime<chrono::Utc> = "2024-01-05T00:00:00Z".parse()?;
    let tie: chrono::DateTime<chrono::Utc> = "2024-01-04T00:00:00Z".parse()?;
    let mid: chrono::DateTime<chrono::Utc> = "2024-01-03T00:00:00Z".parse()?;
    let oldest: chrono::DateTime<chrono::Utc> = "2024-01-02T00:00:00Z".parse()?;

    let mut want: Vec<(chrono::DateTime<chrono::Utc>, Uuid)> = Vec::new();
    for (idx, ts) in [newest, tie, tie, mid, oldest].into_iter().enumerate() {
        let domain = format!("tie{idx}.com");
        let id = insert_company(&pool, team, true, &[domain.as_str()]).await?;
        sqlx::query(
            r#"UPDATE crm_companies
               SET first_interaction = $2, last_interaction = $2
               WHERE id = $1"#,
        )
        .bind(id)
        .bind(ts)
        .execute(&pool)
        .await?;
        want.push((ts, id));
    }
    // Expected DB order: last_interaction DESC, then id DESC. Computed
    // from the ids actually generated, so it holds regardless of which
    // tied row drew the larger uuid.
    want.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let expected: Vec<Uuid> = want.iter().map(|(_, id)| *id).collect();

    let repo = CompaniesRepositoryImpl::new(pool);
    let mut seen: Vec<Uuid> = Vec::new();
    let mut cursor: Option<CrmCompanySoupCursor> = None;
    for _ in 0..10 {
        let page = repo
            .list_companies_for_soup(
                &team,
                "macro|owner@test.com",
                &[],
                None,
                CrmCompanyListSort::UpdatedAt,
                cursor,
                2,
            )
            .await?;
        if page.is_empty() {
            break;
        }
        let last = page.last().unwrap();
        cursor = Some(CrmCompanySoupCursor {
            last_sort_ts: last.company.updated_at,
            last_id: last.company.id,
        });
        let exhausted = page.len() < 2;
        seen.extend(page.iter().map(|c| c.company.id));
        if exhausted {
            break;
        }
    }

    assert_eq!(
        seen, expected,
        "tied timestamps must paginate by id without skipping or repeating across the boundary"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_created_at_orders_by_first_interaction(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, VIEWER).await?;
    enable_crm_for_team(&pool, team).await?;

    // First interactions run opposite to last interactions, so a
    // last_interaction order would come out reversed. Two companies tie on
    // first_interaction to exercise the id tiebreak.
    let mut want = Vec::new();
    for (idx, first_day) in [4, 3, 3, 1].into_iter().enumerate() {
        let last_day = 10 + u32::try_from(idx)?;
        let domain = format!("created{idx}.com");
        let id = insert_company_at(&pool, team, &domain, ts(first_day, 0), ts(last_day, 0)).await?;
        want.push((ts(first_day, 0), id));
    }
    want.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    let expected: Vec<Uuid> = want.iter().map(|(_, id)| *id).collect();

    let repo = CompaniesRepositoryImpl::new(pool);
    for limit in [1, 2, 100] {
        let seen = walk(&repo, &team, CrmCompanyListSort::CreatedAt, limit).await?;
        assert_eq!(seen, expected, "limit {limit}");
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_interaction_sorts_ignore_views(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, VIEWER).await?;
    enable_crm_for_team(&pool, team).await?;

    // Viewed and never-viewed companies alternate under both interaction
    // sorts, one of each tie on both keys, and every view is newer than every
    // interaction, so sorting a viewed company by its view time misplaces it.
    let mut by_first = Vec::new();
    let mut by_last = Vec::new();
    for (idx, (first_day, last_day, viewed)) in [
        (1, 20, true),
        (2, 19, false),
        (3, 18, true),
        (3, 18, false),
        (5, 16, true),
        (6, 15, false),
    ]
    .into_iter()
    .enumerate()
    {
        let domain = format!("interaction{idx}.com");
        let id = insert_company_at(&pool, team, &domain, ts(first_day, 0), ts(last_day, 0)).await?;
        if viewed {
            let view_day = 25 + u32::try_from(idx)?;
            record_history(&pool, VIEWER, CRM_COMPANY, id, ts(view_day, 0)).await?;
        }
        by_first.push((ts(first_day, 0), id));
        by_last.push((ts(last_day, 0), id));
    }

    let repo = CompaniesRepositoryImpl::new(pool);
    for (sort, mut want) in [
        (CrmCompanyListSort::UpdatedAt, by_last),
        (CrmCompanyListSort::CreatedAt, by_first),
    ] {
        want.sort_by(|a, b| b.cmp(a));
        let expected: Vec<Uuid> = want.into_iter().map(|(_, id)| id).collect();
        for limit in [1, 2, 100] {
            let seen = walk(&repo, &team, sort, limit).await?;
            assert_eq!(seen, expected, "{sort:?} limit {limit}");
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_viewed_sorts_use_only_this_users_company_views(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    let other_team = Uuid::now_v7();
    let other_user = "macro|other@test.com";
    seed_team(&pool, team, VIEWER).await?;
    seed_team(&pool, other_team, other_user).await?;
    enable_crm_for_team(&pool, team).await?;
    enable_crm_for_team(&pool, other_team).await?;

    let viewed_old = insert_company_at(&pool, team, "viewed-old.com", ts(1, 0), ts(1, 0)).await?;
    let viewed_new = insert_company_at(&pool, team, "viewed-new.com", ts(1, 0), ts(1, 0)).await?;
    let unviewed_a = insert_company_at(&pool, team, "unviewed-a.com", ts(6, 0), ts(6, 0)).await?;
    let unviewed_b = insert_company_at(&pool, team, "unviewed-b.com", ts(7, 0), ts(7, 0)).await?;
    let elsewhere =
        insert_company_at(&pool, other_team, "elsewhere.com", ts(9, 0), ts(9, 0)).await?;
    record_history(&pool, VIEWER, CRM_COMPANY, viewed_old, ts(2, 0)).await?;
    record_history(&pool, VIEWER, CRM_COMPANY, viewed_new, ts(3, 0)).await?;
    // None of these is this user's view of one of this team's companies.
    record_history(&pool, other_user, CRM_COMPANY, unviewed_a, ts(8, 0)).await?;
    record_history(&pool, VIEWER, "document", unviewed_b, ts(8, 0)).await?;
    record_history(&pool, VIEWER, CRM_COMPANY, elsewhere, ts(8, 0)).await?;

    let repo = CompaniesRepositoryImpl::new(pool);

    // Views newest first, then never-viewed companies by id.
    let viewed_at = repo
        .list_companies_for_soup(
            &team,
            VIEWER,
            &[],
            None,
            CrmCompanyListSort::ViewedAt,
            None,
            100,
        )
        .await?;
    assert_eq!(
        ids(&viewed_at),
        [
            viewed_new,
            viewed_old,
            unviewed_a.max(unviewed_b),
            unviewed_a.min(unviewed_b)
        ]
    );
    let view_times: Vec<Option<DateTime<Utc>>> = viewed_at.iter().map(|c| c.viewed_at).collect();
    assert_eq!(view_times, [Some(ts(3, 0)), Some(ts(2, 0)), None, None]);

    let after_newest_view = repo
        .list_companies_for_soup(
            &team,
            VIEWER,
            &[],
            None,
            CrmCompanyListSort::ViewedAt,
            Some(CrmCompanySoupCursor {
                last_sort_ts: ts(3, 0),
                last_id: viewed_new,
            }),
            1,
        )
        .await?;
    assert_eq!(ids(&after_newest_view), [viewed_old]);

    // Views stand in for last_interaction.
    let viewed_updated = walk(&repo, &team, CrmCompanyListSort::ViewedUpdated, 100).await?;
    assert_eq!(
        viewed_updated,
        [unviewed_b, unviewed_a, viewed_new, viewed_old]
    );

    // Every sort reports this user's view time, with or without an id list.
    let want_views = HashMap::from([
        (viewed_old, Some(ts(2, 0))),
        (viewed_new, Some(ts(3, 0))),
        (unviewed_a, None),
        (unviewed_b, None),
    ]);
    let all = [viewed_old, viewed_new, unviewed_a, unviewed_b];
    for sort in ALL_SORTS {
        for company_ids in [&[][..], &all[..]] {
            let page = repo
                .list_companies_for_soup(&team, VIEWER, company_ids, None, sort, None, 100)
                .await?;
            let got: HashMap<Uuid, Option<DateTime<Utc>>> =
                page.iter().map(|c| (c.company.id, c.viewed_at)).collect();
            assert_eq!(got, want_views, "{sort:?} ids={}", company_ids.len());
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_viewed_updated_interleaves_views_and_interactions(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, VIEWER).await?;
    enable_crm_for_team(&pool, team).await?;

    let c1 = insert_company_at(&pool, team, "vu1.com", ts(1, 0), ts(1, 0)).await?;
    let c2 = insert_company_at(&pool, team, "vu2.com", ts(2, 0), ts(2, 0)).await?;
    let c3 = insert_company_at(&pool, team, "vu3.com", ts(3, 0), ts(3, 0)).await?;
    let c4 = insert_company_at(&pool, team, "vu4.com", ts(4, 0), ts(4, 0)).await?;
    // Sort keys: c1 = day 5 (view), c4 = day 4, c2 = day 2, c3 = day 1 noon
    // (a view older than its last interaction still replaces it).
    record_history(&pool, VIEWER, CRM_COMPANY, c1, ts(5, 0)).await?;
    record_history(&pool, VIEWER, CRM_COMPANY, c3, ts(1, 12)).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    for limit in [1, 2, 100] {
        let seen = walk(&repo, &team, CrmCompanyListSort::ViewedUpdated, limit).await?;
        assert_eq!(seen, [c1, c4, c2, c3], "limit {limit}");
    }

    // An explicit id list keeps each sort's order, the limit, and the cursor.
    let subset = [c3, c4, c1];
    let after_c1 = CrmCompanySoupCursor {
        last_sort_ts: ts(5, 0),
        last_id: c1,
    };
    for (sort, cursor, limit, want) in [
        (
            CrmCompanyListSort::ViewedUpdated,
            None,
            100,
            vec![c1, c4, c3],
        ),
        (CrmCompanyListSort::ViewedAt, None, 100, vec![c1, c3, c4]),
        (CrmCompanyListSort::UpdatedAt, None, 100, vec![c4, c3, c1]),
        (CrmCompanyListSort::ViewedUpdated, None, 2, vec![c1, c4]),
        (
            CrmCompanyListSort::ViewedUpdated,
            Some(after_c1),
            100,
            vec![c4, c3],
        ),
    ] {
        let page = repo
            .list_companies_for_soup(&team, VIEWER, &subset, None, sort, cursor, limit)
            .await?;
        assert_eq!(ids(&page), want, "{sort:?} cursor={cursor:?} limit={limit}");
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_for_soup_hidden_filter_applies_to_every_sort(pool: PgPool) -> anyhow::Result<()> {
    let team = Uuid::now_v7();
    seed_team(&pool, team, VIEWER).await?;
    enable_crm_for_team(&pool, team).await?;

    // A viewed and a never-viewed company on each side of the filter.
    let mut visible = Vec::new();
    let mut hidden = Vec::new();
    for (day, hide, viewed) in [
        (1, false, true),
        (2, false, false),
        (3, true, true),
        (4, true, false),
    ] {
        let domain = format!("hidden{day}.com");
        let id = insert_company_at(&pool, team, &domain, ts(day, 0), ts(day, 0)).await?;
        if viewed {
            record_history(&pool, VIEWER, CRM_COMPANY, id, ts(day, 6)).await?;
        }
        if hide {
            sqlx::query("UPDATE crm_companies SET hidden = TRUE WHERE id = $1")
                .bind(id)
                .execute(&pool)
                .await?;
            hidden.push(id);
        } else {
            visible.push(id);
        }
    }
    visible.sort();
    hidden.sort();

    let repo = CompaniesRepositoryImpl::new(pool);
    for sort in ALL_SORTS {
        for (filter, want) in [
            (None, &visible),
            (Some(false), &visible),
            (Some(true), &hidden),
        ] {
            let page = repo
                .list_companies_for_soup(&team, VIEWER, &[], filter, sort, None, 100)
                .await?;
            let mut got = ids(&page);
            got.sort();
            assert_eq!(&got, want, "{sort:?} hidden={filter:?}");
        }
    }
    Ok(())
}
