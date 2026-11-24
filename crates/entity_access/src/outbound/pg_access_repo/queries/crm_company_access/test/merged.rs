use super::*;
use crate::domain::{
    models::EntityType, ports::EntityAccessService, service::EntityAccessServiceImpl,
};
use crate::outbound::PgAccessRepository;

/// Records that `retired_id` was merged into `survivor_id`.
async fn insert_alias(pool: &PgPool, retired_id: Uuid, survivor_id: Uuid) -> anyhow::Result<()> {
    let merge_id = Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO crm_merges (
            id, team_id, user_id, record_type, request_key, request_fingerprint, survivor_id, source_ids, result
        )
        SELECT $1, team_id, 'macro|admin@example.com', 'company', $2, 'fingerprint', $3, ARRAY[$4]::uuid[], '{}'
        FROM crm_companies WHERE id = $3
        "#,
        merge_id,
        Uuid::now_v7(),
        survivor_id,
        retired_id,
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        "INSERT INTO crm_company_aliases (retired_id, company_id, merge_id) VALUES ($1, $2, $3)",
        retired_id,
        survivor_id,
        merge_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

async fn current_id(pool: &PgPool, id: &str, entity_type: EntityType) -> anyhow::Result<String> {
    let service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool.clone()));
    Ok(service.current_entity_id(id, entity_type).await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../fixtures", scripts("user_team"))
)]
async fn an_old_id_names_the_company_it_was_merged_into(pool: PgPool) -> anyhow::Result<()> {
    let survivor = Uuid::now_v7();
    let retired = Uuid::now_v7();
    insert_company(&pool, survivor, TEAM_ALPHA, false).await?;
    insert_alias(&pool, retired, survivor).await?;
    let (survivor, retired) = (survivor.to_string(), retired.to_string());

    let company = EntityType::CrmCompany;
    assert_eq!(current_id(&pool, &retired, company).await?, survivor);
    assert_eq!(current_id(&pool, &survivor, company).await?, survivor);
    assert_eq!(
        current_id(&pool, "not-a-uuid", company).await?,
        "not-a-uuid"
    );
    assert_eq!(
        current_id(&pool, &retired, EntityType::CrmContact).await?,
        retired
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../fixtures", scripts("user_team"))
)]
async fn an_old_id_names_nothing_once_its_company_is_deleted(pool: PgPool) -> anyhow::Result<()> {
    let survivor = Uuid::now_v7();
    let retired = Uuid::now_v7();
    insert_company(&pool, survivor, TEAM_ALPHA, false).await?;
    insert_alias(&pool, retired, survivor).await?;

    sqlx::query!("DELETE FROM crm_companies WHERE id = $1", survivor)
        .execute(&pool)
        .await?;

    assert!(
        get_merged_crm_company_ids(&pool, &[retired])
            .await?
            .is_empty()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../../fixtures", scripts("user_team"))
)]
async fn access_is_never_granted_through_an_old_id(pool: PgPool) -> anyhow::Result<()> {
    let survivor = Uuid::now_v7();
    let retired = Uuid::now_v7();
    insert_company(&pool, survivor, TEAM_ALPHA, false).await?;
    insert_alias(&pool, retired, survivor).await?;

    let admin = sqlx::query_scalar!(
        "SELECT user_id FROM team_user WHERE team_id = $1 AND team_role = 'admin'",
        TEAM_ALPHA,
    )
    .fetch_one(&pool)
    .await?;
    let admin = MacroUserId::parse_from_str(&admin).unwrap().lowercase();
    let current = get_crm_company_access(&pool, &survivor, &admin).await?;
    assert!(current.is_some());
    assert_eq!(get_crm_company_access(&pool, &retired, &admin).await?, None);
    assert_eq!(
        get_team_crm_company_access(&pool, &retired, &TEAM_ALPHA).await?,
        None
    );
    Ok(())
}
