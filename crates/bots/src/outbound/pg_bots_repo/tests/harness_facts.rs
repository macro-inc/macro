use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_harness_allows_bypass_only_while_its_operator_does(pool: PgPool) -> anyhow::Result<()> {
    insert_user(&pool, USER_OWNER).await?;
    let repo = PgBotsRepo::new(pool.clone());

    // (web consent, operator's last report, effective)
    let cases = [
        (true, None, true),
        (true, Some(true), true),
        (true, Some(false), false),
        (false, None, false),
        (false, Some(true), false),
        (false, Some(false), false),
    ];
    for (allow_permission_bypass, operator_allows_bypass, expected) in cases {
        let harness_id = Uuid::new_v4();
        sqlx::query!(
            r#"
            INSERT INTO harnesses
                (id, name, owner_user_id, created_by, allow_permission_bypass,
                 operator_allows_bypass)
            VALUES ($1, 'test harness', $2, $2, $3, $4)
            "#,
            harness_id,
            USER_OWNER,
            allow_permission_bypass,
            operator_allows_bypass,
        )
        .execute(&pool)
        .await?;

        let facts = repo
            .get_harness_facts(HarnessId::new_from_uuid(harness_id))
            .await?
            .expect("the harness exists");
        assert_eq!(
            facts.allow_permission_bypass, expected,
            "web consent {allow_permission_bypass}, operator {operator_allows_bypass:?}"
        );
    }
    Ok(())
}
