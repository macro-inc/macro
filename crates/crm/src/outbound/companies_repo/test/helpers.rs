use sqlx::PgPool;
use uuid::Uuid;

pub(super) async fn seed_team(pool: &PgPool, team_id: Uuid, owner_id: &str) -> sqlx::Result<()> {
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

pub(super) async fn insert_company(
    pool: &PgPool,
    team_id: Uuid,
    email_sync: bool,
    domains: &[&str],
) -> sqlx::Result<Uuid> {
    let company_id = Uuid::now_v7();

    sqlx::query(
        r#"INSERT INTO crm_companies (id, team_id, email_sync, first_interaction, last_interaction)
           VALUES ($1, $2, $3, now(), now())"#,
    )
    .bind(company_id)
    .bind(team_id)
    .bind(email_sync)
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

pub(super) async fn insert_email_link(
    pool: &PgPool,
    owner_id: &str,
    email: &str,
) -> sqlx::Result<Uuid> {
    let link_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $3, $4, 'GMAIL')"#,
    )
    .bind(link_id)
    .bind(owner_id)
    .bind(format!("fa_{link_id}"))
    .bind(email)
    .execute(pool)
    .await?;
    Ok(link_id)
}

pub(super) async fn insert_contact_with_source(
    pool: &PgPool,
    company_id: Uuid,
    email: &str,
    link_id: Uuid,
) -> sqlx::Result<Uuid> {
    let contact_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO crm_contacts (id, company_id, email, first_interaction, last_interaction)
           VALUES ($1, $2, $3, now(), now())"#,
    )
    .bind(contact_id)
    .bind(company_id)
    .bind(email)
    .execute(pool)
    .await?;
    sqlx::query(r#"INSERT INTO crm_contact_sources (contact_id, link_id) VALUES ($1, $2)"#)
        .bind(contact_id)
        .bind(link_id)
        .execute(pool)
        .await?;
    Ok(contact_id)
}

pub(super) async fn count_contacts(pool: &PgPool, company_id: Uuid) -> sqlx::Result<i64> {
    let (count,): (i64,) =
        sqlx::query_as(r#"SELECT COUNT(*) FROM crm_contacts WHERE company_id = $1"#)
            .bind(company_id)
            .fetch_one(pool)
            .await?;
    Ok(count)
}

pub(super) async fn count_sources_for_company(
    pool: &PgPool,
    company_id: Uuid,
) -> sqlx::Result<i64> {
    let (count,): (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM crm_contact_sources cs
           JOIN crm_contacts ct ON ct.id = cs.contact_id
           WHERE ct.company_id = $1"#,
    )
    .bind(company_id)
    .fetch_one(pool)
    .await?;
    Ok(count)
}

pub(super) async fn fetch_email_sync(
    pool: &PgPool,
    company_id: Uuid,
) -> sqlx::Result<Option<bool>> {
    let row: Option<(bool,)> =
        sqlx::query_as(r#"SELECT email_sync FROM crm_companies WHERE id = $1"#)
            .bind(company_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(s,)| s))
}

pub(super) async fn fetch_company_hidden(
    pool: &PgPool,
    company_id: Uuid,
) -> sqlx::Result<Option<bool>> {
    let row: Option<(bool,)> = sqlx::query_as(r#"SELECT hidden FROM crm_companies WHERE id = $1"#)
        .bind(company_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(h,)| h))
}

pub(super) async fn fetch_contact_hidden(
    pool: &PgPool,
    contact_id: Uuid,
) -> sqlx::Result<Option<bool>> {
    let row: Option<(bool,)> = sqlx::query_as(r#"SELECT hidden FROM crm_contacts WHERE id = $1"#)
        .bind(contact_id)
        .fetch_optional(pool)
        .await?;
    Ok(row.map(|(h,)| h))
}

pub(super) async fn fetch_company_updated_at(
    pool: &PgPool,
    company_id: Uuid,
) -> sqlx::Result<Option<chrono::DateTime<chrono::Utc>>> {
    let row: Option<(chrono::DateTime<chrono::Utc>,)> =
        sqlx::query_as(r#"SELECT updated_at FROM crm_companies WHERE id = $1"#)
            .bind(company_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(updated_at,)| updated_at))
}

pub(super) async fn fetch_contact_updated_at(
    pool: &PgPool,
    contact_id: Uuid,
) -> sqlx::Result<Option<chrono::DateTime<chrono::Utc>>> {
    let row: Option<(chrono::DateTime<chrono::Utc>,)> =
        sqlx::query_as(r#"SELECT updated_at FROM crm_contacts WHERE id = $1"#)
            .bind(contact_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(updated_at,)| updated_at))
}

pub(super) async fn fetch_company_interactions(
    pool: &PgPool,
    company_id: Uuid,
) -> sqlx::Result<Option<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)>> {
    sqlx::query_as(r#"SELECT first_interaction, last_interaction FROM crm_companies WHERE id = $1"#)
        .bind(company_id)
        .fetch_optional(pool)
        .await
}

pub(super) async fn fetch_contact_interactions(
    pool: &PgPool,
    contact_id: Uuid,
) -> sqlx::Result<Option<(chrono::DateTime<chrono::Utc>, chrono::DateTime<chrono::Utc>)>> {
    sqlx::query_as(r#"SELECT first_interaction, last_interaction FROM crm_contacts WHERE id = $1"#)
        .bind(contact_id)
        .fetch_optional(pool)
        .await
}

pub(super) async fn fetch_company_for_domain(
    pool: &PgPool,
    team_id: Uuid,
    domain: &str,
) -> sqlx::Result<Option<Uuid>> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"SELECT c.id
           FROM crm_companies c
           JOIN crm_domains d ON d.company_id = c.id
           WHERE c.team_id = $1 AND LOWER(d.domain) = LOWER($2)
           LIMIT 1"#,
    )
    .bind(team_id)
    .bind(domain)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id,)| id))
}

pub(super) async fn fetch_contact_id(
    pool: &PgPool,
    company_id: Uuid,
    email: &str,
) -> sqlx::Result<Option<Uuid>> {
    let row: Option<(Uuid,)> = sqlx::query_as(
        r#"SELECT id FROM crm_contacts WHERE company_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1"#,
    )
    .bind(company_id)
    .bind(email)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|(id,)| id))
}

pub(super) async fn enable_crm_for_team(pool: &PgPool, team_id: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        r#"INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, TRUE)
           ON CONFLICT (team_id) DO UPDATE SET crm_enabled = TRUE"#,
    )
    .bind(team_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub(super) async fn count_companies_for_domain(
    pool: &PgPool,
    team_id: Uuid,
    domain: &str,
) -> sqlx::Result<i64> {
    let (count,): (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM crm_companies c
           JOIN crm_domains d ON d.company_id = c.id
           WHERE c.team_id = $1 AND LOWER(d.domain) = LOWER($2)"#,
    )
    .bind(team_id)
    .bind(domain)
    .fetch_one(pool)
    .await?;
    Ok(count)
}

/// Inserts a bare contact under `company_id` (no source row needed for the
/// comment tests).
pub(super) async fn insert_contact(
    pool: &PgPool,
    company_id: Uuid,
    email: &str,
) -> sqlx::Result<Uuid> {
    let contact_id = Uuid::now_v7();
    sqlx::query(
        r#"INSERT INTO crm_contacts (id, company_id, email, first_interaction, last_interaction)
           VALUES ($1, $2, $3, now(), now())"#,
    )
    .bind(contact_id)
    .bind(company_id)
    .bind(email)
    .execute(pool)
    .await?;
    Ok(contact_id)
}

/// Counts live (non-soft-deleted) threads.
pub(super) async fn count_threads(pool: &PgPool) -> sqlx::Result<i64> {
    let (count,): (i64,) =
        sqlx::query_as(r#"SELECT COUNT(*) FROM crm_thread WHERE deleted_at IS NULL"#)
            .fetch_one(pool)
            .await?;
    Ok(count)
}
