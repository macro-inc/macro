use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::domain::model::{CrmCompanyContactsQuery, CrmError};
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

fn query(archived: bool, search: &str, limit: i64) -> CrmCompanyContactsQuery {
    CrmCompanyContactsQuery {
        archived,
        search: search.to_string(),
        cursor: None,
        limit,
    }
}

/// Every page of one filter, followed through its cursors.
async fn all_pages(
    repo: &CompaniesRepositoryImpl,
    team_id: Uuid,
    company_id: Uuid,
    include_hidden: bool,
    mut query: CrmCompanyContactsQuery,
) -> anyhow::Result<Vec<Uuid>> {
    let mut ids = Vec::new();
    loop {
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
}

async fn insert_named(
    pool: &PgPool,
    company_id: Uuid,
    email: Option<&str>,
    name: Option<&str>,
) -> anyhow::Result<Uuid> {
    let id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO crm_contacts (id, company_id, email, name, first_interaction, last_interaction)
           VALUES ($1, $2, $3, $4, now(), now())"#,
    )
    .bind(id)
    .bind(company_id)
    .bind(email)
    .bind(name)
    .execute(pool)
    .await?;
    Ok(id)
}

async fn hide_contact(pool: &PgPool, id: Uuid) -> anyhow::Result<()> {
    sqlx::query(r#"UPDATE crm_contacts SET hidden = TRUE WHERE id = $1"#)
        .bind(id)
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
    sqlx::query(r#"UPDATE crm_companies SET hidden = TRUE WHERE id = $1"#)
        .bind(company_id)
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
