use std::sync::Arc;

use entity_access::domain::models::EntityType as AccessEntityType;
use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole, TeamRole,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use properties::domain::model::TaskAssignedNotification;
use properties::domain::model::{EditReceipt, ViewReceipt};
use properties::{NotificationService, PermissionService, PropertiesPgRepo, PropertiesServiceImpl};
use sqlx::PgPool;
use uuid::Uuid;

use super::*;
use crate::domain::stages::{StageInsert, StageRewrite};
use crate::outbound::companies_repo::test::helpers::seed_team;

struct NoPermissions;

impl PermissionService for NoPermissions {
    type Err = anyhow::Error;

    async fn mint_view_receipt<'a>(
        &self,
        _user_id: Option<&'a MacroUserIdStr<'a>>,
        _entity_id: &str,
        _entity_type: AccessEntityType,
    ) -> Result<ViewReceipt, Self::Err> {
        unimplemented!("stage definitions never mint view receipts")
    }

    async fn mint_edit_receipt<'a>(
        &self,
        _user_id: &MacroUserIdStr<'a>,
        _entity_id: &str,
        _entity_type: AccessEntityType,
    ) -> Result<EditReceipt, Self::Err> {
        unimplemented!("stage definitions never mint edit receipts")
    }

    async fn grant_permissions_to_task<'a>(
        &self,
        _user_ids: &[MacroUserIdStr<'a>],
        _task_id: &str,
    ) -> Result<(), Self::Err> {
        unimplemented!("stage definitions never grant task permissions")
    }
}

struct NoNotifications;

impl NotificationService for NoNotifications {
    type Err = anyhow::Error;

    async fn send_task_assigned<'a>(
        &self,
        _notification: TaskAssignedNotification<'a>,
    ) -> Result<(), Self::Err> {
        unimplemented!("stage definitions never notify")
    }
}

type Store = PropertiesStageDefinitionStore<
    PropertiesServiceImpl<PropertiesPgRepo, NoPermissions, NoNotifications>,
>;

fn store(pool: &PgPool) -> Store {
    PropertiesStageDefinitionStore::new(Arc::new(PropertiesServiceImpl::new(
        PropertiesPgRepo::new(pool.clone()),
        None::<NoPermissions>,
        None::<NoNotifications>,
    )))
}

async fn team_receipt(pool: &PgPool, email: &str) -> CrmTeamReceipt<MemberTeamRole> {
    let team_id = Uuid::now_v7();
    seed_team(pool, team_id, email).await.expect("seed team");
    let user = MacroUserIdStr::parse_from_str(email).unwrap().into_owned();
    CrmTeamReceipt::from_team_receipt(
        EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
            user,
            Entity {
                entity_id: team_id.to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole {
                role: TeamRole::Admin,
            },
        )
        .unwrap(),
    )
    .unwrap()
}

fn labels(set: &TeamStageSet) -> Vec<&str> {
    set.stages
        .iter()
        .map(|stage| stage.label.as_str())
        .collect()
}

fn owned(labels: &[&str]) -> Vec<String> {
    labels.iter().map(|label| (*label).to_string()).collect()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_without_definition_has_no_stage_set(pool: PgPool) {
    let access = team_receipt(&pool, "macro|owner@test.com").await;
    assert_eq!(
        store(&pool).get_team_stage_set(&access).await.unwrap(),
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_seeds_options_in_order_and_reads_back(pool: PgPool) {
    let access = team_receipt(&pool, "macro|owner@test.com").await;
    let store = store(&pool);

    let created = store
        .create_team_stage_set(&access, &owned(&["Lead", "Demo", "Customer"]))
        .await
        .unwrap();
    assert_eq!(labels(&created), ["Lead", "Demo", "Customer"]);
    assert_eq!(
        created
            .stages
            .iter()
            .map(|stage| stage.display_order)
            .collect::<Vec<_>>(),
        [0, 1, 2]
    );

    let read = store.get_team_stage_set(&access).await.unwrap();
    assert_eq!(read, Some(created));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replace_applies_delete_rewrite_and_insert_together(pool: PgPool) {
    let access = team_receipt(&pool, "macro|owner@test.com").await;
    let store = store(&pool);
    let set = store
        .create_team_stage_set(&access, &owned(&["Lead", "Demo", "Churned"]))
        .await
        .unwrap();
    let [lead, demo, churned] = [set.stages[0].id, set.stages[1].id, set.stages[2].id];

    let replaced = store
        .replace_stages(
            &access,
            set.definition_id,
            StageReplacePlan {
                delete: vec![churned],
                rewrite: vec![
                    StageRewrite {
                        id: demo,
                        label: "Demo call".into(),
                        display_order: 0,
                    },
                    StageRewrite {
                        id: lead,
                        label: "Lead".into(),
                        display_order: 1,
                    },
                ],
                insert: vec![StageInsert {
                    label: "Renewal".into(),
                    display_order: 2,
                }],
            },
        )
        .await
        .unwrap();
    assert_eq!(labels(&replaced), ["Demo call", "Lead", "Renewal"]);
    assert_eq!(replaced.stages[0].id, demo);
    assert_eq!(replaced.stages[1].id, lead);
    assert_eq!(
        store.get_team_stage_set(&access).await.unwrap(),
        Some(replaced)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn two_stages_can_trade_labels(pool: PgPool) {
    let access = team_receipt(&pool, "macro|owner@test.com").await;
    let store = store(&pool);
    let set = store
        .create_team_stage_set(&access, &owned(&["Lead", "Demo"]))
        .await
        .unwrap();
    let [lead, demo] = [set.stages[0].id, set.stages[1].id];
    let replaced = store
        .replace_stages(
            &access,
            set.definition_id,
            StageReplacePlan {
                rewrite: vec![
                    StageRewrite {
                        id: lead,
                        label: "Demo".into(),
                        display_order: 0,
                    },
                    StageRewrite {
                        id: demo,
                        label: "Lead".into(),
                        display_order: 1,
                    },
                ],
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(labels(&replaced), ["Demo", "Lead"]);
    assert_eq!(replaced.stages[0].id, lead);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn duplicate_label_rolls_back_the_whole_plan(pool: PgPool) {
    let access = team_receipt(&pool, "macro|owner@test.com").await;
    let store = store(&pool);
    let set = store
        .create_team_stage_set(&access, &owned(&["Lead", "Demo"]))
        .await
        .unwrap();
    let err = store
        .replace_stages(
            &access,
            set.definition_id,
            StageReplacePlan {
                delete: vec![set.stages[1].id],
                insert: vec![StageInsert {
                    label: "Lead".into(),
                    display_order: 1,
                }],
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::InvalidRequest(_)), "{err:?}");
    assert_eq!(
        labels(&store.get_team_stage_set(&access).await.unwrap().unwrap()),
        ["Lead", "Demo"]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn duplicate_label_is_a_client_error(pool: PgPool) {
    let access = team_receipt(&pool, "macro|owner@test.com").await;
    let store = store(&pool);
    let set = store
        .create_team_stage_set(&access, &owned(&["Lead"]))
        .await
        .unwrap();
    let err = store
        .replace_stages(
            &access,
            set.definition_id,
            StageReplacePlan {
                insert: vec![StageInsert {
                    label: "Lead".into(),
                    display_order: 1,
                }],
                ..Default::default()
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::InvalidRequest(_)), "{err:?}");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_set_returns_team_to_defaults(pool: PgPool) {
    let access = team_receipt(&pool, "macro|owner@test.com").await;
    let store = store(&pool);
    let set = store
        .create_team_stage_set(&access, &owned(&["Lead"]))
        .await
        .unwrap();
    store
        .delete_team_stage_set(&access, set.definition_id)
        .await
        .unwrap();
    assert_eq!(store.get_team_stage_set(&access).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn another_team_cannot_see_or_touch_the_set(pool: PgPool) {
    let owner = team_receipt(&pool, "macro|owner@test.com").await;
    let stranger = team_receipt(&pool, "macro|stranger@test.com").await;
    let store = store(&pool);
    let set = store
        .create_team_stage_set(&owner, &owned(&["Lead"]))
        .await
        .unwrap();

    assert_eq!(store.get_team_stage_set(&stranger).await.unwrap(), None);
    assert!(
        store
            .replace_stages(
                &stranger,
                set.definition_id,
                StageReplacePlan {
                    insert: vec![StageInsert {
                        label: "Intruder".into(),
                        display_order: 1,
                    }],
                    ..Default::default()
                },
            )
            .await
            .is_err()
    );
    assert!(
        store
            .delete_team_stage_set(&stranger, set.definition_id)
            .await
            .is_err()
    );
    assert_eq!(
        labels(&store.get_team_stage_set(&owner).await.unwrap().unwrap()),
        ["Lead"]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn internal_receipt_cannot_write(pool: PgPool) {
    let team_id = Uuid::now_v7();
    seed_team(&pool, team_id, "macro|owner@test.com")
        .await
        .unwrap();
    let access = CrmTeamReceipt::<MemberTeamRole>::dangerously_internal(team_id);
    let err = store(&pool)
        .create_team_stage_set(&access, &owned(&["Lead"]))
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::InvalidRequest(_)), "{err:?}");
}
