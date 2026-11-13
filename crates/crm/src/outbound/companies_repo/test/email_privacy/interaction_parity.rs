//! The set-based interaction scan must return what filtering the same threads
//! with `crm_email_thread_allowed` returns.
use super::*;
use chrono::DateTime;

type Scan = (Option<DateTime<Utc>>, Option<DateTime<Utc>>, Option<bool>);

async fn scan(pool: &PgPool, team: Uuid, link: Uuid, email: &str) -> anyhow::Result<Scan> {
    let set_based = sqlx::query_file!(
        "src/outbound/companies_repo/email_privacy/interactions.sql",
        team,
        link,
        email
    )
    .fetch_one(pool)
    .await?;
    let reference = sqlx::query_file!(
        "src/outbound/companies_repo/test/email_privacy/reference_interactions.sql",
        team,
        link,
        email
    )
    .fetch_one(pool)
    .await?;
    let set_based = (set_based.first_at, set_based.last_at, set_based.is_sent);
    assert_eq!(
        set_based,
        (reference.first_at, reference.last_at, reference.is_sent),
        "set-based scan diverged from crm_email_thread_allowed for {email}"
    );
    Ok(set_based)
}

async fn add_participant(
    pool: &PgPool,
    link: Uuid,
    thread: Uuid,
    email: &str,
    recipient_type: &str,
    drafts: bool,
) -> anyhow::Result<()> {
    let contact = sqlx::query_scalar!(
        r#"INSERT INTO email_contacts (id, link_id, email_address) VALUES ($1, $2, $3)
           ON CONFLICT (link_id, email_address) DO UPDATE SET email_address = EXCLUDED.email_address RETURNING id"#,
        Uuid::now_v7(),
        link,
        email
    )
    .fetch_one(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) SELECT id, $2, $3::text::email_recipient_type FROM email_messages WHERE thread_id = $1 AND is_draft = $4",
        thread,
        contact,
        recipient_type,
        drafts
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_draft(pool: &PgPool, link: Uuid, thread: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        "INSERT INTO email_messages (id, thread_id, link_id, internal_date_ts, is_sent, is_draft) VALUES ($1, $2, $3, now(), TRUE, TRUE)",
        Uuid::now_v7(),
        thread,
        link
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn insert_member(pool: &PgPool, team: Uuid, user: &str) -> anyhow::Result<()> {
    let macro_user = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
        macro_user,
        user
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        user,
        macro_user
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
        team,
        user
    )
    .execute(pool)
    .await?;
    Ok(())
}

fn at(month: u32) -> DateTime<Utc> {
    format!("2025-{month:02}-01T00:00:00Z").parse().unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_based_scan_applies_every_privacy_rule_like_thread_allowed(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    insert_interaction(&pool, link, "kept@acme.example.com", at(1), true).await?;
    let team_blocked =
        insert_interaction(&pool, link, "kept@acme.example.com", at(2), true).await?;
    add_participant(
        &pool,
        link,
        team_blocked,
        "cc@mail.blocked.example",
        "CC",
        false,
    )
    .await?;
    let personal =
        insert_interaction(&pool, link, "personal@acme.example.com", at(3), false).await?;
    add_participant(&pool, link, personal, "bcc@private.example", "BCC", false).await?;
    let sync_off = insert_interaction(&pool, link, "quiet@acme.example.com", at(4), true).await?;
    add_participant(&pool, link, sync_off, "cc@Sales.Quiet.Example", "TO", false).await?;
    let draft = insert_interaction(&pool, link, "draft@acme.example.com", at(5), true).await?;
    insert_draft(&pool, link, draft).await?;
    add_participant(&pool, link, draft, "cc@blocked.example", "CC", true).await?;
    let lookalike =
        insert_interaction(&pool, link, "lookalike@acme.example.com", at(6), true).await?;
    add_participant(&pool, link, lookalike, "cc@notblocked.example", "CC", false).await?;

    assert_eq!(
        scan(&pool, team, link, "kept@acme.example.com").await?,
        (Some(at(1)), Some(at(2)), Some(true))
    );
    assert_eq!(
        scan(&pool, team, link, "personal@acme.example.com").await?,
        (Some(at(3)), Some(at(3)), Some(false))
    );

    for (scope, domain) in [
        (EmailBlockScope::Team, "blocked.example"),
        (EmailBlockScope::Personal, "private.example"),
    ] {
        repo.change_email_privacy(
            team,
            OWNER,
            EmailPrivacyChange::AddDomain {
                scope,
                domain: domain.into(),
            },
        )
        .await?;
    }
    let quiet = insert_company(&pool, team, false, &["Quiet.Example"]).await?;
    // Another member's personal blocklist never applies to this mailbox.
    let colleague = "macro|colleague@example.com";
    insert_member(&pool, team, colleague).await?;
    sqlx::query!(
        "INSERT INTO crm_personal_email_blocklist (team_id, user_id, domain) VALUES ($1, $2, 'acme.example.com')",
        team,
        colleague
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        scan(&pool, team, link, "kept@acme.example.com").await?,
        (Some(at(1)), Some(at(1)), Some(true)),
        "a blocked subdomain participant removes only its own thread"
    );
    assert_eq!(
        scan(&pool, team, link, "personal@acme.example.com").await?,
        (None, None, None)
    );
    assert_eq!(
        scan(&pool, team, link, "quiet@acme.example.com").await?,
        (None, None, None),
        "a company with email sync off blocks its mixed-case subdomains"
    );
    assert_eq!(
        scan(&pool, team, link, "draft@acme.example.com").await?,
        (Some(at(5)), Some(at(5)), Some(true)),
        "drafts are not participants"
    );
    assert_eq!(
        scan(&pool, team, link, "lookalike@acme.example.com").await?,
        (Some(at(6)), Some(at(6)), Some(true))
    );

    sqlx::query!(
        "UPDATE crm_companies SET email_sync = TRUE WHERE id = $1",
        quiet
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        scan(&pool, team, link, "quiet@acme.example.com").await?,
        (Some(at(4)), Some(at(4)), Some(true))
    );

    let other_team = Uuid::now_v7();
    seed_team(&pool, other_team, "macro|other-owner@example.com").await?;
    assert_eq!(
        scan(&pool, other_team, link, "kept@acme.example.com").await?,
        (None, None, None),
        "consent is per team"
    );
    repo.change_email_privacy(
        team,
        OWNER,
        EmailPrivacyChange::SetConsent {
            enabled: false,
            link_id: None,
        },
    )
    .await?;
    for email in [
        "kept@acme.example.com",
        "draft@acme.example.com",
        "lookalike@acme.example.com",
        "quiet@acme.example.com",
    ] {
        assert_eq!(
            scan(&pool, team, link, email).await?,
            (None, None, None),
            "revoked consent hides {email}"
        );
    }
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn set_based_domain_matching_agrees_with_domain_blocked_on_edge_cases(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (_repo, team, link) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let participants = [
        "p@a.example",
        "p@sub.a.example",
        "p@a.example.test",
        "p@xa.example",
        "p@A.Example",
        "p@",
        "no-at-sign",
        "p@trailing.",
        "p@double..dots.test",
        "p@x@y.example",
    ];
    for (index, participant) in participants.iter().enumerate() {
        let thread = insert_interaction(
            &pool,
            link,
            &format!("c{index}@corr.invalid"),
            at(1 + index as u32),
            true,
        )
        .await?;
        add_participant(&pool, link, thread, participant, "CC", false).await?;
    }
    let raw_entries = [
        "a.example",
        "A.EXAMPLE",
        "example",
        "",
        ".dots.test",
        "dots.test",
        "trailing.",
        "y.example",
        "test",
    ];
    for entry in raw_entries {
        let lowered = entry.to_lowercase();
        let mut scopes = vec!["sync_off"];
        if entry == lowered {
            scopes.push("team");
            if !entry.is_empty() {
                scopes.push("personal");
            }
        }
        for scope in scopes {
            let mut tx = pool.begin().await?;
            match scope {
                "team" => {
                    sqlx::query!(
                        "INSERT INTO crm_blocked_domains (team_id, domain) VALUES ($1, $2)",
                        team,
                        entry
                    )
                    .execute(&mut *tx)
                    .await?;
                }
                "personal" => {
                    sqlx::query!(
                        "INSERT INTO crm_personal_email_blocklist (team_id, user_id, domain) VALUES ($1, $2, $3)",
                        team,
                        OWNER,
                        entry
                    )
                    .execute(&mut *tx)
                    .await?;
                }
                _ => {
                    let company = Uuid::now_v7();
                    sqlx::query!(
                        "INSERT INTO crm_companies (id, team_id, email_sync, first_interaction, last_interaction) VALUES ($1, $2, FALSE, now(), now())",
                        company,
                        team
                    )
                    .execute(&mut *tx)
                    .await?;
                    sqlx::query!(
                        "INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)",
                        company,
                        team,
                        entry
                    )
                    .execute(&mut *tx)
                    .await?;
                }
            }
            for (index, participant) in participants.iter().enumerate() {
                let email = format!("c{index}@corr.invalid");
                let set_based = sqlx::query_file!(
                    "src/outbound/companies_repo/email_privacy/interactions.sql",
                    team,
                    link,
                    email
                )
                .fetch_one(&mut *tx)
                .await?;
                let blocked = sqlx::query_scalar!(
                    r#"SELECT crm_email_domain_blocked($1, $2, split_part($3, '@', 2)) AS "blocked!""#,
                    team,
                    OWNER,
                    participant
                )
                .fetch_one(&mut *tx)
                .await?;
                assert_eq!(
                    set_based.first_at.is_none(),
                    blocked,
                    "{scope} entry {entry:?} vs participant {participant:?}"
                );
            }
            tx.rollback().await?;
        }
    }
    Ok(())
}
