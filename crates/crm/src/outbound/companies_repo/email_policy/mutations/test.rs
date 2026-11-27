use super::*;

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../email/fixtures",
        scripts("email_crm_selected")
    )
)]
async fn selected_admission_preserves_the_mutation_statement_timeout(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    let team = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0001);
    let user = "macro|owner@example.com";
    let repo = CompaniesRepositoryImpl::new(pool);
    let observed = repo.inspect_email_policy(team, user).await?;
    let mut authoring = repo
        .open_email_policy_authoring(team, user, observed.token.as_ref().unwrap(), true)
        .await?
        .unwrap();
    let before = sqlx::query_scalar!("SELECT current_setting('statement_timeout')")
        .fetch_one(&mut *authoring.tx)
        .await?;
    assert_eq!(before.as_deref(), Some("15s"));
    authoring
        .admit_rule_resources(&[EmailInclusionRule::Address {
            address: "selected@client.example".into(),
        }])
        .await?;
    let after = sqlx::query_scalar!("SELECT current_setting('statement_timeout')")
        .fetch_one(&mut *authoring.tx)
        .await?;
    assert_eq!(after, before);
    authoring.tx.rollback().await?;
    Ok(())
}
