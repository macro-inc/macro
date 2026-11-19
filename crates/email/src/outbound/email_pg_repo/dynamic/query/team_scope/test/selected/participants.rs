use super::*;

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../../../../../../fixtures",
        scripts("email_crm_selected", "email_crm_long_selected_thread")
    )
)]
async fn a_late_blocked_participant_overrides_an_early_inclusion(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    sqlx::query!(
        "INSERT INTO crm_email_rule_addresses (team_id, user_id, revision, address) VALUES ($1, $2, 1, 'selected@client.example')",
        S_TEAM, S_USER,
    )
    .execute(&pool)
    .await?;
    parity(&pool, true).await?;
    sqlx::query!(
        "INSERT INTO crm_personal_email_blocklist (team_id, user_id, domain) VALUES ($1, $2, 'private.example')",
        S_TEAM, S_USER,
    )
    .execute(&pool)
    .await?;
    parity(&pool, false).await?;
    assert_eq!(
        selected_page(&pool, Some(TeamReadTuning::DEFAULT)).await?,
        vec![S_COPY],
        "the eligible teammate copy survives the excluded preferred copy"
    );
    Ok(())
}
