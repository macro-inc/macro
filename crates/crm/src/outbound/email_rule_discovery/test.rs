use super::*;

#[sqlx::test(
    migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../email/fixtures", scripts("email_crm_selected"))
)]
async fn small_matching_stops_before_the_suffix_allowance_is_exceeded(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    let link = Uuid::from_u128(0x0000_0000_0000_4000_8000_0000_0000_0011);
    let ids = [
        Uuid::from_u128(101),
        Uuid::from_u128(102),
        Uuid::from_u128(103),
    ];
    sqlx::query!("INSERT INTO email_contacts(id,link_id,email_address) SELECT id,$1,address FROM unnest($2::uuid[],$3::text[]) value(id,address)",link,&ids[..],&["a@sub.example","b@sub.example","c@sub.example"] as &[&str])
        .execute(&pool).await?;
    let mut tx = pool.begin().await?;
    let mut reader = Reader {
        connection: &mut tx,
        deadline: Instant::now() + std::time::Duration::from_secs(10),
    };
    let result = reader
        .small_matches(link, &[], &["example".into()], 3, 1024, 4)
        .await?;
    assert_eq!(result.rows, 3);
    assert_eq!(
        result.suffix_checks, 6,
        "raw accounting must expose the overflow"
    );
    assert_eq!(result.ids.len(), 2, "matching stops at the allowance");
    assert!(result.ids.iter().all(|id| ids.contains(id)));
    tx.rollback().await?;
    Ok(())
}
