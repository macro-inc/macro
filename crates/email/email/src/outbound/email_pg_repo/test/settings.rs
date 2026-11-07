use super::*;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("email_message"))
)]
async fn fetch_email_settings_maps_signature_fields(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let link_id = Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")?;
    sqlx::query!(
        r#"
        INSERT INTO email_settings (link_id, signature_on_replies_forwards, signature)
        VALUES ($1, TRUE, '<p>Regards</p>')
        "#,
        link_id
    )
    .execute(&pool)
    .await?;

    let settings = EmailPgRepo::new(pool).fetch_email_settings(link_id).await?;

    assert!(settings.signature_on_replies_forwards);
    assert_eq!(settings.signature.as_deref(), Some("<p>Regards</p>"));
    Ok(())
}
