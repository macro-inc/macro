mod http;

use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::domain::model::{CrmCompanyContactsQuery, CrmError};
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

/// More pages than any test company holds at one contact per page.
const MAX_PAGES: usize = 64;

fn query(archived: bool, search: &str, limit: i64) -> CrmCompanyContactsQuery {
    CrmCompanyContactsQuery {
        archived,
        search: search.to_string(),
        cursor: None,
        limit,
    }
}

/// Every page of one filter, followed through its cursors. Gives up after
/// [`MAX_PAGES`], so a cursor that stops advancing fails instead of hanging.
async fn all_pages(
    repo: &CompaniesRepositoryImpl,
    team_id: Uuid,
    company_id: Uuid,
    include_hidden: bool,
    mut query: CrmCompanyContactsQuery,
) -> anyhow::Result<Vec<Uuid>> {
    let mut ids = Vec::new();
    for _ in 0..MAX_PAGES {
        let page = repo
            .list_company_contacts_page(&team_id, &company_id, include_hidden, &query)
            .await?;
        assert!(page.contacts.len() <= usize::try_from(query.limit)?);
        ids.extend(page.contacts.iter().map(|c| c.id));
        match page.next_cursor {
            Some(cursor) => query.cursor = Some(cursor),
            None => return Ok(ids),
        }
    }
    anyhow::bail!("the pages did not end after {MAX_PAGES} requests")
}

async fn insert_named(
    pool: &PgPool,
    company_id: Uuid,
    email: Option<&str>,
    name: Option<&str>,
) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO crm_contacts (id, company_id, email, name, first_interaction, last_interaction)
           VALUES ($1, $2, $3, $4, now(), now())"#,
        id,
        company_id,
        email,
        name,
    )
    .execute(pool)
    .await?;
    Ok(id)
}

async fn hide_contact(pool: &PgPool, id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(r#"UPDATE crm_contacts SET hidden = TRUE WHERE id = $1"#, id,)
        .execute(pool)
        .await?;
    Ok(())
}

/// A company whose contacts cover every ordering case: names and emails
/// that tie once lowercased, a name-only contact, two contacts with
/// neither (they sort last), and hidden contacts among them.
async fn seed_company(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid, Vec<Uuid>)> {
    let team_id = Uuid::now_v7();
    seed_team(pool, team_id, "macro|owner@owner.test").await?;
    let company_id = insert_company(pool, team_id, true, &["acme.test"]).await?;
    let mut hidden = Vec::new();
    insert_named(pool, company_id, Some("zoe@acme.test"), Some("Zoe Adams")).await?;
    insert_named(pool, company_id, Some("anna@acme.test"), Some("anna smith")).await?;
    insert_named(
        pool,
        company_id,
        Some("anna2@acme.test"),
        Some("Anna Smith"),
    )
    .await?;
    insert_named(
        pool,
        company_id,
        Some("anna3@acme.test"),
        Some("ANNA SMITH"),
    )
    .await?;
    insert_named(pool, company_id, Some("mike@acme.test"), None).await?;
    insert_named(pool, company_id, None, Some("Nobody Mailed")).await?;
    insert_named(pool, company_id, None, None).await?;
    insert_named(pool, company_id, None, None).await?;
    hidden.push(insert_named(pool, company_id, Some("bob@acme.test"), Some("Bob")).await?);
    hidden.push(
        insert_named(
            pool,
            company_id,
            Some("anna4@acme.test"),
            Some("anna smith"),
        )
        .await?,
    );
    hidden.push(insert_named(pool, company_id, None, None).await?);
    for id in &hidden {
        hide_contact(pool, *id).await?;
    }
    Ok((team_id, company_id, hidden))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pages_hold_the_full_list_in_its_order(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, company_id, hidden) = seed_company(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool);

    for include_hidden in [false, true] {
        let full: Vec<Uuid> = repo
            .list_contacts_for_company(&team_id, &company_id, include_hidden)
            .await?
            .iter()
            .map(|c| c.id)
            .collect();
        let active: Vec<Uuid> = full
            .iter()
            .copied()
            .filter(|id| !hidden.contains(id))
            .collect();
        let archived: Vec<Uuid> = full
            .iter()
            .copied()
            .filter(|id| hidden.contains(id))
            .collect();

        for limit in [1, 2, 3, 50] {
            let pages = all_pages(
                &repo,
                team_id,
                company_id,
                include_hidden,
                query(false, "", limit),
            )
            .await?;
            assert_eq!(
                pages, active,
                "active, include_hidden={include_hidden}, limit={limit}"
            );
            let pages = all_pages(
                &repo,
                team_id,
                company_id,
                include_hidden,
                query(true, "", limit),
            )
            .await?;
            assert_eq!(
                pages, archived,
                "archived, include_hidden={include_hidden}, limit={limit}"
            );
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn last_page_has_no_cursor(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, company_id, _) = seed_company(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool);

    // Eight active contacts: a page of exactly eight is the last one.
    let page = repo
        .list_company_contacts_page(&team_id, &company_id, false, &query(false, "", 8))
        .await?;
    assert_eq!(page.contacts.len(), 8);
    assert!(page.next_cursor.is_none());

    let page = repo
        .list_company_contacts_page(&team_id, &company_id, false, &query(false, "", 7))
        .await?;
    assert_eq!(page.contacts.len(), 7);
    assert!(page.next_cursor.is_some());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_matches_name_or_primary_email_ignoring_case(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, company_id, _) = seed_company(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool);

    let names = |contacts: &[crate::domain::model::CrmContact]| -> Vec<Option<String>> {
        contacts.iter().map(|c| c.email.clone()).collect()
    };

    let page = repo
        .list_company_contacts_page(&team_id, &company_id, true, &query(false, "ANNA S", 50))
        .await?;
    assert_eq!(page.contacts.len(), 3);
    assert!(page.contacts.iter().all(|c| !c.hidden));

    let page = repo
        .list_company_contacts_page(&team_id, &company_id, true, &query(false, "MIKE@", 50))
        .await?;
    assert_eq!(
        names(&page.contacts),
        vec![Some("mike@acme.test".to_string())]
    );

    let page = repo
        .list_company_contacts_page(&team_id, &company_id, true, &query(true, "anna", 50))
        .await?;
    assert_eq!(
        names(&page.contacts),
        vec![Some("anna4@acme.test".to_string())]
    );

    let page = repo
        .list_company_contacts_page(
            &team_id,
            &company_id,
            true,
            &query(false, "nobody here", 50),
        )
        .await?;
    assert!(page.contacts.is_empty());
    assert!(page.next_cursor.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn archived_company_lists_every_contact_as_archived(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, company_id, _) = seed_company(&pool).await?;
    sqlx::query!(
        r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#,
        company_id,
    )
    .execute(&pool)
    .await?;
    let repo = CompaniesRepositoryImpl::new(pool);

    // Admin: nothing active; every contact, hidden or not, archived.
    let full: Vec<Uuid> = repo
        .list_contacts_for_company(&team_id, &company_id, true)
        .await?
        .iter()
        .map(|c| c.id)
        .collect();
    assert!(
        all_pages(&repo, team_id, company_id, true, query(false, "", 2))
            .await?
            .is_empty()
    );
    assert_eq!(
        all_pages(&repo, team_id, company_id, true, query(true, "", 2)).await?,
        full
    );

    // Member: the archived company is not visible.
    let member = repo
        .list_company_contacts_page(&team_id, &company_id, false, &query(true, "", 2))
        .await;
    assert!(matches!(member, Err(CrmError::CompanyNotFoundForTeam)));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn empty_company_returns_empty_page(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@owner.test").await?;
    let company_id = insert_company(&pool, team_id, true, &["acme.test"]).await?;
    let repo = CompaniesRepositoryImpl::new(pool);

    let page = repo
        .list_company_contacts_page(&team_id, &company_id, false, &query(false, "", 10))
        .await?;
    assert!(page.contacts.is_empty());
    assert!(page.next_cursor.is_none());
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn other_team_and_unknown_company_are_not_found(pool: PgPool) -> anyhow::Result<()> {
    let (team_a, company_a, _) = seed_company(&pool).await?;
    let team_b = Uuid::now_v7();
    seed_team(&pool, team_b, "macro|b@owner.test").await?;
    let repo = CompaniesRepositoryImpl::new(pool);

    let result = repo
        .list_company_contacts_page(&team_b, &company_a, true, &query(false, "", 10))
        .await;
    assert!(matches!(result, Err(CrmError::CompanyNotFoundForTeam)));

    let result = repo
        .list_company_contacts_page(&team_a, &Uuid::now_v7(), true, &query(false, "", 10))
        .await;
    assert!(matches!(result, Err(CrmError::CompanyNotFoundForTeam)));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn search_pages_follow_their_cursor_to_the_filtered_list(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, company_id, hidden) = seed_company(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool);
    let full = repo
        .list_contacts_for_company(&team_id, &company_id, true)
        .await?;

    for search in ["anna", "ACME.TEST", "o"] {
        let needle = search.to_lowercase();
        for archived in [false, true] {
            // The full list narrowed the way the web client narrowed it.
            let expected: Vec<Uuid> = full
                .iter()
                .filter(|c| hidden.contains(&c.id) == archived)
                .filter(|c| {
                    [&c.name, &c.email].into_iter().any(|text| {
                        text.as_deref()
                            .is_some_and(|text| text.to_lowercase().contains(&needle))
                    })
                })
                .map(|c| c.id)
                .collect();
            for limit in [1, 2] {
                let pages = all_pages(
                    &repo,
                    team_id,
                    company_id,
                    true,
                    query(archived, search, limit),
                )
                .await?;
                assert_eq!(
                    pages, expected,
                    "search={search}, archived={archived}, limit={limit}"
                );
            }
        }
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn cursor_names_the_list_it_continues(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, company_id, _) = seed_company(&pool).await?;
    let repo = CompaniesRepositoryImpl::new(pool);

    let list = query(false, "anna", 1);
    let cursor = repo
        .list_company_contacts_page(&team_id, &company_id, true, &list)
        .await?
        .next_cursor
        .expect("three active Annas make several pages");
    assert_eq!(cursor.company_id, company_id);
    assert!(!cursor.archived);
    assert!(cursor.continues(company_id, &list));
    assert!(!cursor.continues(Uuid::now_v7(), &list));
    assert!(!cursor.continues(company_id, &query(true, "anna", 1)));
    assert!(!cursor.continues(company_id, &query(false, "ann", 1)));
    // The page size is not part of the list.
    assert!(cursor.continues(company_id, &query(false, "anna", 50)));
    Ok(())
}

/// Adds `email` to the contact's addresses, recorded `days_ago` days before
/// a fixed instant, so equal days tie exactly.
async fn add_address(
    pool: &PgPool,
    contact_id: Uuid,
    email: &str,
    days_ago: i32,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO crm_contact_emails (contact_id, email, created_at)
           VALUES ($1, $2, '2026-01-10T00:00:00Z'::timestamptz - make_interval(days => $3))
           ON CONFLICT (contact_id, email) DO UPDATE SET created_at = EXCLUDED.created_at"#,
        contact_id,
        email,
        days_ago,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// The page path builds each contact exactly as the full read does: every
/// field, the address order, and which addresses are on a domain of the
/// contact's own company in its own team.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn page_contacts_equal_the_full_read(pool: PgPool) -> anyhow::Result<()> {
    let (team_id, company_id, _) = seed_company(&pool).await?;
    // Another company of the team, and another team, each with a domain the
    // contact holds an address at. The other team's row names this company,
    // so only its team keeps it from counting.
    insert_company(&pool, team_id, true, &["other.test"]).await?;
    let other_team = Uuid::now_v7();
    seed_team(&pool, other_team, "macro|owner@other.test").await?;
    sqlx::query!(
        r#"INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, 'foreign.test')"#,
        company_id,
        other_team,
    )
    .execute(&pool)
    .await?;

    let pat = insert_named(&pool, company_id, Some("pat@acme.test"), Some("Pat")).await?;
    // The primary is the newest address, yet it comes first; the rest go
    // oldest first, ties by address. The oldest company address sorts after a
    // newer one by name, so both lists show age order, not address order.
    add_address(&pool, pat, "pat@acme.test", 0).await?;
    add_address(&pool, pat, "pat@other.test", 2).await?;
    add_address(&pool, pat, "pat@foreign.test", 2).await?;
    add_address(&pool, pat, "b.pat@acme.test", 3).await?;
    add_address(&pool, pat, "a.pat@acme.test", 1).await?;

    let repo = CompaniesRepositoryImpl::new(pool);
    let full = repo
        .list_contacts_for_company(&team_id, &company_id, true)
        .await?;
    let mut paged = Vec::new();
    for archived in [false, true] {
        let mut list = query(archived, "", 2);
        for _ in 0..MAX_PAGES {
            let page = repo
                .list_company_contacts_page(&team_id, &company_id, true, &list)
                .await?;
            paged.extend(page.contacts);
            match page.next_cursor {
                Some(cursor) => list.cursor = Some(cursor),
                None => break,
            }
        }
    }
    assert_eq!(paged.len(), full.len());
    for contact in &full {
        let page_contact = paged
            .iter()
            .find(|c| c.id == contact.id)
            .expect("every contact is on a page");
        assert_eq!(
            serde_json::to_value(page_contact)?,
            serde_json::to_value(contact)?,
            "contact {:?}",
            contact.email
        );
    }

    let pat = paged.iter().find(|c| c.id == pat).expect("Pat is listed");
    assert_eq!(
        pat.emails,
        [
            "pat@acme.test",
            "b.pat@acme.test",
            "pat@foreign.test",
            "pat@other.test",
            "a.pat@acme.test",
        ]
    );
    assert_eq!(
        pat.company_domain_emails,
        ["b.pat@acme.test", "a.pat@acme.test", "pat@acme.test"]
    );
    Ok(())
}
