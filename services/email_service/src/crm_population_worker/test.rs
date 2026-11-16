use super::*;
use crm::domain::email_privacy::{EmailPrivacyChange, EmailPrivacyRepository};
use crm::domain::service::CrmServiceImpl;
use crm::outbound::companies_repo::CompaniesRepositoryImpl;
use crm::outbound::no_op_resolver::NoOpCompanyMetadataResolver;
use email::outbound::crm_population_pg::request;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_email::service::backfill::PopulateCrmContactPayload;

const USER: &str = "macro|lanes@example.com";
const CONTACT: &str = "person@example.org";

/// A team whose owner's mailbox contributes to the CRM, with one stored
/// message sent to [`CONTACT`].
async fn contributing_mailbox(pool: &PgPool) -> anyhow::Result<(Uuid, Uuid)> {
    let macro_user = Uuid::now_v7();
    let team = Uuid::now_v7();
    let link = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        macro_user,
        USER,
        format!("stripe_{macro_user}")
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        USER,
        macro_user
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Lanes test', $2)",
        team,
        USER
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')",
        team,
        USER
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
           VALUES ($1, $2, $3, 'lanes@example.com', 'GMAIL')"#,
        link,
        USER,
        format!("fa_{link}")
    )
    .execute(pool)
    .await?;
    CompaniesRepositoryImpl::new(pool.clone())
        .change_email_privacy(
            team,
            USER,
            EmailPrivacyChange::SetConsent {
                enabled: true,
                link_id: Some(link),
            },
        )
        .await?;
    let thread = Uuid::now_v7();
    let message = Uuid::now_v7();
    let contact = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) VALUES ($1, $2)",
        thread,
        link
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)",
        contact,
        link,
        CONTACT
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO email_messages (id, thread_id, link_id, internal_date_ts, is_sent, is_draft)
           VALUES ($1, $2, $3, now(), TRUE, FALSE)"#,
        message,
        thread,
        link
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) VALUES ($1, $2, 'TO')",
        message,
        contact
    )
    .execute(pool)
    .await?;
    Ok((team, link))
}

async fn pending(pool: &PgPool) -> anyhow::Result<i64> {
    Ok(
        sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM crm_population_requests"#)
            .fetch_one(pool)
            .await?,
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_recorded_request_reaches_the_crm_through_a_lane(pool: PgPool) -> anyhow::Result<()> {
    let (team, link) = contributing_mailbox(&pool).await?;
    let at = chrono::Utc::now();
    request(
        &pool,
        link,
        &[PopulateCrmContactPayload {
            contact_email: CONTACT.into(),
            contact_name: Some("Person".into()),
            first_at: at,
            last_at: at,
            is_sent: true,
        }],
        None,
    )
    .await
    .map_err(|report| anyhow::anyhow!("{report}"))?;
    assert_eq!(pending(&pool).await?, 1);
    // Skip the wait that lets a burst of requests for one correspondent settle.
    sqlx::query!("UPDATE crm_population_requests SET due_at = now()")
        .execute(&pool)
        .await?;

    let service = Arc::new(CrmPopulationService {
        ledger: ledger(&pool),
        crm: CrmPopulationContacts(CrmServiceImpl::new(
            CompaniesRepositoryImpl::new(pool.clone()),
            NoOpCompanyMetadataResolver,
        )),
    });
    let cancellation = CancellationToken::new();
    // More lanes than a process runs, as when several processes share the ledger.
    let lanes: Vec<_> = (0..3)
        .map(|_| tokio::spawn(lane(service.clone(), cancellation.clone())))
        .collect();
    tokio::time::timeout(Duration::from_secs(30), async {
        while pending(&pool).await? > 0 {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        anyhow::Ok(())
    })
    .await??;
    cancellation.cancel();
    for lane in lanes {
        tokio::time::timeout(Duration::from_secs(10), lane).await??;
    }

    let contacts = sqlx::query_scalar!(
        r#"SELECT ct.email
           FROM crm_contacts ct
           JOIN crm_contact_sources s ON s.contact_id = ct.id
           WHERE ct.team_id = $1 AND s.link_id = $2"#,
        team,
        link
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(contacts, [Some(CONTACT.to_owned())]);
    Ok(())
}
