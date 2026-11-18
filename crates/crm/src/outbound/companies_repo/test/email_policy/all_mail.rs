//! Behavior parity also provides a local, alternating throughput capture without
//! imposing timing thresholds on a shared CI host.
use super::*;
use crate::domain::{
    email_policy_work::{EmailHistoryAuthority, EmailPolicyWorkService},
    service::{CrmService, CrmServiceImpl},
};
use crate::outbound::no_op_resolver::NoOpCompanyMetadataResolver;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_history_preserves_all_mail_population(pool: PgPool) -> anyhow::Result<()> {
    let count: usize = std::env::var("CRM_HISTORY_BENCH_CONTACTS")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(4);
    let rounds: usize = std::env::var("CRM_HISTORY_BENCH_ROUNDS")
        .ok()
        .and_then(|n| n.parse().ok())
        .unwrap_or(2);
    let (team, link, repo) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let service = CrmServiceImpl::new(repo, NoOpCompanyMetadataResolver);
    let first =
        chrono::DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")?.with_timezone(&chrono::Utc);
    let last = first + chrono::Duration::days(10);
    let mut contacts = Vec::new();
    for n in 0..count {
        let email = format!("contact{n:05}@sample.example.com");
        let sent = n < count / 2;
        insert_interaction(&pool, link, &email, first, sent).await?;
        insert_interaction(&pool, link, &email, last, sent).await?;
        contacts.push((email, sent));
    }
    // The same formerly queued contact is now excluded on both paths.
    let denied = insert_interaction(&pool, link, "private@sample.example.com", first, true).await?;
    sqlx::query!("INSERT INTO crm_email_thread_exclusions(team_id,user_id,link_id,thread_id) VALUES($1,$2,$3,$4)",team,OWNER,link,denied).execute(&pool).await?;
    contacts.push(("private@sample.example.com".into(), true));
    contacts.sort_by_key(|(_, sent)| !sent);
    let mut expected = None;
    for round in 0..rounds {
        for modern in if round % 2 == 0 {
            [false, true]
        } else {
            [true, false]
        } {
            // Only this test's synthetic CRM records are reset between A/B runs.
            sqlx::query!("DELETE FROM crm_companies WHERE team_id=$1", team)
                .execute(&pool)
                .await?;
            let started = std::time::Instant::now();
            for (email, sent) in &contacts {
                if modern {
                    service
                        .populate_history_contact(
                            team,
                            link,
                            "owner@example.com",
                            email,
                            None,
                            EmailHistoryAuthority::Legacy,
                            false,
                        )
                        .await?;
                } else {
                    service
                        .populate_contact(
                            &team,
                            &link,
                            "owner@example.com",
                            email,
                            None,
                            first,
                            last,
                            *sent,
                        )
                        .await?;
                }
            }
            let elapsed = started.elapsed();
            let rows=sqlx::query!("SELECT ct.email,ct.first_interaction,ct.last_interaction FROM crm_contacts ct WHERE ct.team_id=$1 ORDER BY ct.email",team).fetch_all(&pool).await?;
            let rows: Vec<_> = rows
                .into_iter()
                .map(|r| (r.email, r.first_interaction, r.last_interaction))
                .collect();
            assert_eq!(rows.len(), count, "excluded contact never appears");
            assert!(rows.iter().all(|(_, f, l)| *f == first && *l == last));
            if let Some(expected) = &expected {
                assert_eq!(&rows, expected);
            } else {
                expected = Some(rows);
            }
            assert_eq!(sqlx::query_scalar!("SELECT count(*) FROM crm_contact_sources s JOIN crm_contacts ct ON ct.id=s.contact_id WHERE ct.team_id=$1",team).fetch_one(&pool).await?,Some(count as i64));
            eprintln!(
                "CRM_HISTORY_AB round={round} variant={} contacts={} elapsed_us={}",
                if modern { "current" } else { "main" },
                contacts.len(),
                elapsed.as_micros()
            );
        }
    }
    Ok(())
}
