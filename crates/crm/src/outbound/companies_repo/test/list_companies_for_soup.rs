use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

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
    assert!(result.is_empty());
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
