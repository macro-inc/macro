use super::helpers::*;
use crate::domain::companies_repo::*;
use crate::domain::model::{CrmPermissionRole, CrmTeamSettingsPatch};
use crate::outbound::companies_repo::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;
use sqlx::PgPool;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_team_settings_missing_row_returns_defaults(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let settings = repo.get_team_settings(&team_id).await?;

    assert_eq!(settings.edit_stages_role, CrmPermissionRole::Admin);
    assert_eq!(settings.move_closed_deals_role, CrmPermissionRole::Admin);
    assert_eq!(settings.delete_records_role, CrmPermissionRole::Admin);
    assert_eq!(settings.closed_stage_ids, None);
    assert_eq!(settings.team_views, json!([]));
    assert_eq!(settings.default_team_view_id, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn get_team_settings_row_from_enable_flow_returns_defaults(
    pool: PgPool,
) -> anyhow::Result<()> {
    // A row created by the enable-CRM flow (crm_enabled only) must read
    // back the config column defaults.
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;
    sqlx::query(r#"INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, TRUE)"#)
        .bind(team_id)
        .execute(&pool)
        .await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let settings = repo.get_team_settings(&team_id).await?;

    assert_eq!(settings.edit_stages_role, CrmPermissionRole::Admin);
    assert_eq!(settings.closed_stage_ids, None);
    assert_eq!(settings.team_views, json!([]));
    assert_eq!(settings.default_team_view_id, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_team_settings_inserts_and_preserves_crm_enabled(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let patch = CrmTeamSettingsPatch {
        edit_stages_role: Some(CrmPermissionRole::Owner),
        ..Default::default()
    };
    let settings = repo.update_team_settings(&team_id, &patch).await?;

    assert_eq!(settings.edit_stages_role, CrmPermissionRole::Owner);
    assert_eq!(settings.move_closed_deals_role, CrmPermissionRole::Admin);

    // The insert must not flip the killswitch.
    let crm_enabled: bool =
        sqlx::query_scalar(r#"SELECT crm_enabled FROM team_crm_settings WHERE team_id = $1"#)
            .bind(team_id)
            .fetch_one(&pool)
            .await?;
    assert!(!crm_enabled);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_team_settings_partial_changes_only_provided_fields(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let stage_id = Uuid::now_v7();
    let full = CrmTeamSettingsPatch {
        edit_stages_role: Some(CrmPermissionRole::Owner),
        move_closed_deals_role: Some(CrmPermissionRole::Owner),
        delete_records_role: Some(CrmPermissionRole::Owner),
        closed_stage_ids: Some(Some(vec![stage_id])),
        team_views: Some(json!([{ "id": "v1", "name": "My view" }])),
        default_team_view_id: Some(Some("v1".to_string())),
    };
    repo.update_team_settings(&team_id, &full).await?;

    // Change one field; everything else must survive.
    let partial = CrmTeamSettingsPatch {
        move_closed_deals_role: Some(CrmPermissionRole::Admin),
        ..Default::default()
    };
    let settings = repo.update_team_settings(&team_id, &partial).await?;

    assert_eq!(settings.move_closed_deals_role, CrmPermissionRole::Admin);
    assert_eq!(settings.edit_stages_role, CrmPermissionRole::Owner);
    assert_eq!(settings.delete_records_role, CrmPermissionRole::Owner);
    assert_eq!(settings.closed_stage_ids, Some(vec![stage_id]));
    assert_eq!(
        settings.team_views,
        json!([{ "id": "v1", "name": "My view" }])
    );
    assert_eq!(settings.default_team_view_id, Some("v1".to_string()));
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_team_settings_tristate_clears_nullable_fields(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let set = CrmTeamSettingsPatch {
        closed_stage_ids: Some(Some(vec![Uuid::now_v7()])),
        default_team_view_id: Some(Some("v1".to_string())),
        ..Default::default()
    };
    repo.update_team_settings(&team_id, &set).await?;

    // Omitted (outer None) leaves the values alone.
    let untouched = repo
        .update_team_settings(&team_id, &CrmTeamSettingsPatch::default())
        .await?;
    assert!(untouched.closed_stage_ids.is_some());
    assert_eq!(untouched.default_team_view_id, Some("v1".to_string()));

    // Explicit inner None clears them.
    let clear = CrmTeamSettingsPatch {
        closed_stage_ids: Some(None),
        default_team_view_id: Some(None),
        ..Default::default()
    };
    let cleared = repo.update_team_settings(&team_id, &clear).await?;
    assert_eq!(cleared.closed_stage_ids, None);
    assert_eq!(cleared.default_team_view_id, None);
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_team_settings_replaces_team_views_whole(pool: PgPool) -> anyhow::Result<()> {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com").await?;

    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let first = CrmTeamSettingsPatch {
        team_views: Some(json!([{ "id": "a" }, { "id": "b" }])),
        ..Default::default()
    };
    repo.update_team_settings(&team_id, &first).await?;

    let second = CrmTeamSettingsPatch {
        team_views: Some(json!([{ "id": "c" }])),
        ..Default::default()
    };
    let settings = repo.update_team_settings(&team_id, &second).await?;

    assert_eq!(settings.team_views, json!([{ "id": "c" }]));
    Ok(())
}
