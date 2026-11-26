//! Admission is identical for validation and activation, with atomic refusal.
use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resource_refusal_keeps_legacy_consent_history_and_identity_unchanged(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, _) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let contact = insert_contact(&pool, company, "peer@example.com").await?;
    let oversized = "x".repeat(4_097);
    sqlx::query!(
        "INSERT INTO crm_contact_emails(contact_id,email) VALUES($1,$2)",
        contact,
        &oversized
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO crm_domains(company_id,team_id,domain) VALUES($1,$2,$3)",
        company,
        team,
        &oversized
    )
    .execute(&pool)
    .await?;
    let app = app(&pool, Arc::new(AtomicBool::new(true)));
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    assert_eq!(token["kind"], "legacy");
    let before = metadata(&pool, team).await?;
    for rule in [
        json!({"kind":"contact","contact_id":contact}),
        json!({"kind":"company","company_id":company}),
    ] {
        let rules = json!({"schema_version":1,"include":[rule]});
        let (status, validation) = request(&app, "agent", "/validate", Some(rules.clone())).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{validation}");
        assert!(
            validation["message"]
                .as_str()
                .unwrap()
                .contains("source_value_bytes limit (4096)")
        );
        let command = json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"replace_rules","rules":rules}});
        let (status, rejected) = request(&app, "agent", "/policy", Some(command)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{rejected}");
        assert_eq!(
            validation, rejected,
            "the same resource checker must name the same limit"
        );
        assert_eq!(
            metadata(&pool, team).await?,
            before,
            "failed admission rolls back first-write identity and legacy-work transfer"
        );
    }
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM crm_email_policy_idempotency WHERE team_id=$1",
            team
        )
        .fetch_one(&pool)
        .await?,
        Some(0)
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn validation_is_not_a_reservation_and_growth_cannot_block_withdrawal(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (team, link, _) = setup(&pool).await?;
    consent_to_mailbox(&pool, team, link).await?;
    let company = insert_company(&pool, team, true, &["example.com"]).await?;
    let contact = insert_contact(&pool, company, "peer@example.com").await?;
    let rollout = Arc::new(AtomicBool::new(true));
    let app = app(&pool, rollout.clone());
    let token = request(&app, "owner", "/policy", None).await.1["token"].clone();
    let rules = json!({"schema_version":1,"include":[{"kind":"contact","contact_id":contact}]});
    let (status, validated) = request(&app, "agent", "/validate", Some(rules.clone())).await;
    assert_eq!(status, StatusCode::OK, "{validated}");
    let oversized = "x".repeat(4_097);
    sqlx::query!(
        "INSERT INTO crm_contact_emails(contact_id,email) VALUES($1,$2)",
        contact,
        &oversized
    )
    .execute(&pool)
    .await?;
    let before = metadata(&pool, team).await?;
    let command = json!({"if_policy":token,"request_id":Uuid::now_v7(),"change":{"action":"replace_rules","rules":rules}});
    assert_eq!(
        request(&app, "agent", "/policy", Some(command.clone()))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(metadata(&pool, team).await?, before);
    sqlx::query!(
        "DELETE FROM crm_contact_emails WHERE contact_id=$1 AND email=$2",
        contact,
        &oversized
    )
    .execute(&pool)
    .await?;
    let (status, activated) = request(&app, "agent", "/policy", Some(command)).await;
    assert_eq!(status, StatusCode::OK, "{activated}");
    sqlx::query!(
        "INSERT INTO crm_contact_emails(contact_id,email) VALUES($1,$2)",
        contact,
        &oversized
    )
    .execute(&pool)
    .await?;
    rollout.store(false, Ordering::SeqCst);
    let withdraw = json!({"if_policy":activated["token"],"request_id":Uuid::now_v7(),"change":{"action":"withdraw"}});
    let (status, withdrawn) = request(&app, "owner", "/policy", Some(withdraw)).await;
    assert_eq!(status, StatusCode::OK, "{withdrawn}");
    assert_eq!(withdrawn["enabled"], false);
    Ok(())
}
