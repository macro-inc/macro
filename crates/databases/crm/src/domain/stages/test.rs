use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType, TeamRole,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use system_properties::StageOption;

use super::*;
use crate::domain::model::CrmPermissionRole;

#[derive(Clone, Default)]
struct StubSettings {
    settings: Arc<Mutex<CrmTeamSettings>>,
    patches: Arc<Mutex<Vec<CrmTeamSettingsPatch>>>,
}

impl StubSettings {
    fn requiring(role: CrmPermissionRole) -> Self {
        let stub = Self::default();
        stub.settings.lock().unwrap().edit_stages_role = role;
        stub
    }

    fn with_closed(self, ids: Vec<Uuid>) -> Self {
        self.settings.lock().unwrap().closed_stage_ids = Some(ids);
        self
    }

    fn with_legacy(self, map: BTreeMap<Uuid, Uuid>) -> Self {
        self.settings.lock().unwrap().legacy_stage_ids = map;
        self
    }

    fn legacy(&self) -> BTreeMap<Uuid, Uuid> {
        self.settings.lock().unwrap().legacy_stage_ids.clone()
    }

    fn patches(&self) -> Vec<CrmTeamSettingsPatch> {
        self.patches.lock().unwrap().clone()
    }
}

impl TeamSettingsStore for StubSettings {
    async fn read_team_settings(&self, _team_id: &Uuid) -> Result<CrmTeamSettings, CrmError> {
        Ok(self.settings.lock().unwrap().clone())
    }

    async fn patch_team_settings(
        &self,
        _team_id: &Uuid,
        patch: &CrmTeamSettingsPatch,
    ) -> Result<CrmTeamSettings, CrmError> {
        self.patches.lock().unwrap().push(patch.clone());
        let mut settings = self.settings.lock().unwrap();
        if let Some(closed) = &patch.closed_stage_ids {
            settings.closed_stage_ids = closed.clone();
        }
        if let Some(legacy) = &patch.legacy_stage_ids {
            settings.legacy_stage_ids = legacy.clone();
        }
        Ok(settings.clone())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Write {
    Create(Vec<String>),
    Replace(StageReplacePlan),
    DeleteSet,
}

#[derive(Clone, Default)]
struct MemoryStore {
    set: Arc<Mutex<Option<TeamStageSet>>>,
    writes: Arc<Mutex<Vec<Write>>>,
}

impl MemoryStore {
    fn customized(labels: &[&str]) -> Self {
        let store = Self::default();
        *store.set.lock().unwrap() = Some(TeamStageSet {
            definition_id: Uuid::now_v7(),
            stages: labels
                .iter()
                .enumerate()
                .map(|(index, label)| TeamStage {
                    id: Uuid::now_v7(),
                    label: (*label).to_string(),
                    display_order: index as i32,
                })
                .collect(),
        });
        store
    }

    fn stage_ids(&self) -> Vec<Uuid> {
        self.set
            .lock()
            .unwrap()
            .as_ref()
            .map(|set| set.stages.iter().map(|stage| stage.id).collect())
            .unwrap_or_default()
    }

    fn writes(&self) -> Vec<Write> {
        self.writes.lock().unwrap().clone()
    }

    fn record(&self, write: Write) {
        self.writes.lock().unwrap().push(write);
    }
}

impl StageDefinitionStore for MemoryStore {
    async fn get_team_stage_set(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Option<TeamStageSet>, CrmError> {
        Ok(self.set.lock().unwrap().clone().map(|mut set| {
            set.stages.sort_by_key(|stage| stage.display_order);
            set
        }))
    }

    async fn create_team_stage_set(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        labels: &[String],
    ) -> Result<TeamStageSet, CrmError> {
        self.record(Write::Create(labels.to_vec()));
        let set = TeamStageSet {
            definition_id: Uuid::now_v7(),
            stages: labels
                .iter()
                .enumerate()
                .map(|(index, label)| TeamStage {
                    id: Uuid::now_v7(),
                    label: label.clone(),
                    display_order: index as i32,
                })
                .collect(),
        };
        *self.set.lock().unwrap() = Some(set.clone());
        Ok(set)
    }

    async fn replace_stages(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        definition_id: Uuid,
        plan: StageReplacePlan,
    ) -> Result<TeamStageSet, CrmError> {
        self.record(Write::Replace(plan.clone()));
        let mut guard = self.set.lock().unwrap();
        let set = guard.as_mut().expect("replace on missing set");
        set.stages.retain(|stage| !plan.delete.contains(&stage.id));
        for rewrite in &plan.rewrite {
            let stage = set
                .stages
                .iter_mut()
                .find(|stage| stage.id == rewrite.id)
                .expect("rewrite of missing stage");
            stage.label = rewrite.label.clone();
            stage.display_order = rewrite.display_order;
        }
        for insert in &plan.insert {
            set.stages.push(TeamStage {
                id: Uuid::now_v7(),
                label: insert.label.clone(),
                display_order: insert.display_order,
            });
        }
        set.stages.sort_by_key(|stage| stage.display_order);
        assert_eq!(set.definition_id, definition_id);
        Ok(set.clone())
    }

    async fn delete_team_stage_set(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _definition_id: Uuid,
    ) -> Result<(), CrmError> {
        self.record(Write::DeleteSet);
        *self.set.lock().unwrap() = None;
        Ok(())
    }
}

fn service(
    required: CrmPermissionRole,
    store: MemoryStore,
) -> CrmStageServiceImpl<StubSettings, MemoryStore> {
    CrmStageServiceImpl::new(StubSettings::requiring(required), store)
}

fn receipt_with_role(role: TeamRole) -> CrmTeamReceipt<MemberTeamRole> {
    let user = MacroUserIdStr::parse_from_str("macro|user@example.com")
        .unwrap()
        .into_owned();
    CrmTeamReceipt::from_team_receipt(
        EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
            user,
            Entity {
                entity_id: Uuid::now_v7().to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole { role },
        )
        .unwrap(),
    )
    .unwrap()
}

fn new_stage(label: &str) -> StageInput {
    StageInput {
        id: None,
        label: label.to_string(),
    }
}

fn keep(id: Uuid, label: &str) -> StageInput {
    StageInput {
        id: Some(id),
        label: label.to_string(),
    }
}

fn labels(set: &TeamStageSet) -> Vec<&str> {
    set.stages
        .iter()
        .map(|stage| stage.label.as_str())
        .collect()
}

#[tokio::test]
async fn member_cannot_edit_stages_when_admin_required() {
    let store = MemoryStore::default();
    let err = service(CrmPermissionRole::Admin, store.clone())
        .replace_stages(
            &receipt_with_role(TeamRole::Member),
            vec![new_stage("Lead")],
        )
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        CrmError::StageEditRoleRequired(CrmPermissionRole::Admin)
    ));
    assert!(store.writes().is_empty());
}

#[tokio::test]
async fn admin_cannot_edit_stages_when_owner_required() {
    let store = MemoryStore::default();
    let err = service(CrmPermissionRole::Owner, store.clone())
        .replace_stages(&receipt_with_role(TeamRole::Admin), vec![new_stage("Lead")])
        .await
        .unwrap_err();
    assert!(matches!(
        err,
        CrmError::StageEditRoleRequired(CrmPermissionRole::Owner)
    ));
    assert!(store.writes().is_empty());
}

#[tokio::test]
async fn owner_satisfies_every_threshold() {
    for required in [CrmPermissionRole::Admin, CrmPermissionRole::Owner] {
        let store = MemoryStore::default();
        service(required, store)
            .replace_stages(&receipt_with_role(TeamRole::Owner), vec![new_stage("Lead")])
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn reset_is_gated_the_same_way() {
    let store = MemoryStore::customized(&["Lead"]);
    let err = service(CrmPermissionRole::Admin, store.clone())
        .reset_stages(&receipt_with_role(TeamRole::Member))
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::StageEditRoleRequired(_)));
    assert!(store.writes().is_empty());
}

#[tokio::test]
async fn uncustomized_team_gets_a_definition_seeded_in_order() {
    let store = MemoryStore::default();
    let set = service(CrmPermissionRole::Admin, store.clone())
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![
                new_stage(" Lead "),
                new_stage("Demo"),
                new_stage("Customer"),
            ],
        )
        .await
        .unwrap();
    assert_eq!(labels(&set), ["Lead", "Demo", "Customer"]);
    assert_eq!(
        store.writes(),
        [Write::Create(vec![
            "Lead".into(),
            "Demo".into(),
            "Customer".into()
        ])]
    );
}

#[tokio::test]
async fn uncustomized_team_rejects_stage_ids() {
    let store = MemoryStore::default();
    let err = service(CrmPermissionRole::Admin, store.clone())
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(Uuid::now_v7(), "Lead")],
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::InvalidRequest(_)));
    assert!(store.writes().is_empty());
}

#[tokio::test]
async fn customized_team_is_diffed_not_recreated() {
    let store = MemoryStore::customized(&["Lead", "Demo", "Customer", "Churned"]);
    let [lead, demo, customer, churned] = store.stage_ids()[..] else {
        panic!("expected four seeded stages");
    };

    let set = service(CrmPermissionRole::Admin, store.clone())
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![
                keep(lead, "Lead"),
                keep(customer, "Customer"),
                keep(demo, "Demo call"),
                new_stage("Renewal"),
            ],
        )
        .await
        .unwrap();

    assert_eq!(labels(&set), ["Lead", "Customer", "Demo call", "Renewal"]);
    assert_eq!(
        store.writes(),
        [Write::Replace(StageReplacePlan {
            delete: vec![churned],
            rewrite: vec![
                StageRewrite {
                    id: customer,
                    label: "Customer".into(),
                    display_order: 1,
                },
                StageRewrite {
                    id: demo,
                    label: "Demo call".into(),
                    display_order: 2,
                },
            ],
            insert: vec![StageInsert {
                label: "Renewal".into(),
                display_order: 3,
            }],
        })]
    );
}

#[tokio::test]
async fn swapping_two_labels_is_one_plan() {
    let store = MemoryStore::customized(&["Lead", "Demo"]);
    let [lead, demo] = store.stage_ids()[..] else {
        panic!("expected two seeded stages");
    };
    let set = service(CrmPermissionRole::Admin, store.clone())
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(lead, "Demo"), keep(demo, "Lead")],
        )
        .await
        .unwrap();
    assert_eq!(labels(&set), ["Demo", "Lead"]);
    assert_eq!(set.stages[0].id, lead);
    assert_eq!(store.writes().len(), 1);
}

#[tokio::test]
async fn deleting_a_closed_stage_prunes_the_closed_set() {
    let store = MemoryStore::customized(&["Lead", "Won", "Lost"]);
    let [lead, won, lost] = store.stage_ids()[..] else {
        panic!("expected three seeded stages");
    };
    let settings = StubSettings::requiring(CrmPermissionRole::Admin).with_closed(vec![won, lost]);
    CrmStageServiceImpl::new(settings.clone(), store)
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(lead, "Lead"), keep(won, "Won")],
        )
        .await
        .unwrap();
    let patches = settings.patches();
    assert_eq!(patches.len(), 1);
    assert_eq!(patches[0].closed_stage_ids, Some(Some(vec![won])));
}

#[tokio::test]
async fn an_identical_put_still_prunes_stale_closed_ids() {
    let store = MemoryStore::customized(&["Lead", "Won"]);
    let [lead, won] = store.stage_ids()[..] else {
        panic!("expected two seeded stages");
    };
    let settings =
        StubSettings::requiring(CrmPermissionRole::Admin).with_closed(vec![won, Uuid::now_v7()]);
    CrmStageServiceImpl::new(settings.clone(), store.clone())
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(lead, "Lead"), keep(won, "Won")],
        )
        .await
        .unwrap();
    assert!(store.writes().is_empty());
    assert_eq!(
        settings.patches()[0].closed_stage_ids,
        Some(Some(vec![won]))
    );
}

#[tokio::test]
async fn deleting_the_last_closed_stage_keeps_an_explicit_empty_set() {
    let store = MemoryStore::customized(&["Lead", "Won"]);
    let [lead, won] = store.stage_ids()[..] else {
        panic!("expected two seeded stages");
    };
    let settings = StubSettings::requiring(CrmPermissionRole::Admin).with_closed(vec![won]);
    CrmStageServiceImpl::new(settings.clone(), store)
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(lead, "Lead")],
        )
        .await
        .unwrap();
    assert_eq!(settings.patches()[0].closed_stage_ids, Some(Some(vec![])));
}

#[tokio::test]
async fn customizing_clears_closed_ids_that_pointed_at_the_defaults() {
    let store = MemoryStore::default();
    let settings =
        StubSettings::requiring(CrmPermissionRole::Admin).with_closed(vec![Uuid::now_v7()]);
    CrmStageServiceImpl::new(settings.clone(), store)
        .replace_stages(&receipt_with_role(TeamRole::Admin), vec![new_stage("Lead")])
        .await
        .unwrap();
    assert_eq!(settings.patches()[0].closed_stage_ids, Some(None));
}

#[tokio::test]
async fn reset_on_defaults_still_clears_a_stale_closed_set() {
    let store = MemoryStore::default();
    let settings =
        StubSettings::requiring(CrmPermissionRole::Admin).with_closed(vec![Uuid::now_v7()]);
    CrmStageServiceImpl::new(settings.clone(), store)
        .reset_stages(&receipt_with_role(TeamRole::Admin))
        .await
        .unwrap();
    assert_eq!(settings.patches()[0].closed_stage_ids, Some(None));
}

#[tokio::test]
async fn deleting_an_unclosed_stage_leaves_settings_alone() {
    let store = MemoryStore::customized(&["Lead", "Won"]);
    let [lead, won] = store.stage_ids()[..] else {
        panic!("expected two seeded stages");
    };
    let settings = StubSettings::requiring(CrmPermissionRole::Admin)
        .with_closed(vec![won])
        .with_legacy(BTreeMap::from([(StageOption::LEAD_UUID, lead)]));
    CrmStageServiceImpl::new(settings.clone(), store)
        .replace_stages(&receipt_with_role(TeamRole::Admin), vec![keep(won, "Won")])
        .await
        .unwrap();
    assert!(settings.patches().is_empty());
}

#[tokio::test]
async fn reset_clears_the_closed_set() {
    let store = MemoryStore::customized(&["Lead", "Won"]);
    let [_, won] = store.stage_ids()[..] else {
        panic!("expected two seeded stages");
    };
    let settings = StubSettings::requiring(CrmPermissionRole::Admin).with_closed(vec![won]);
    CrmStageServiceImpl::new(settings.clone(), store)
        .reset_stages(&receipt_with_role(TeamRole::Admin))
        .await
        .unwrap();
    assert_eq!(settings.patches()[0].closed_stage_ids, Some(None));
}

#[tokio::test]
async fn unchanged_stages_are_not_rewritten() {
    let store = MemoryStore::customized(&["Lead", "Demo"]);
    let [lead, demo] = store.stage_ids()[..] else {
        panic!("expected two seeded stages");
    };
    service(CrmPermissionRole::Admin, store.clone())
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(lead, "Lead"), keep(demo, "Demo")],
        )
        .await
        .unwrap();
    assert!(store.writes().is_empty());
}

#[tokio::test]
async fn foreign_stage_id_is_rejected_before_any_write() {
    let store = MemoryStore::customized(&["Lead"]);
    let [lead] = store.stage_ids()[..] else {
        panic!("expected one seeded stage");
    };
    let err = service(CrmPermissionRole::Admin, store.clone())
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(lead, "Lead"), keep(Uuid::now_v7(), "Stranger")],
        )
        .await
        .unwrap_err();
    assert!(matches!(err, CrmError::InvalidRequest(_)));
    assert!(store.writes().is_empty());
}

#[tokio::test]
async fn invalid_sets_are_rejected() {
    let too_many: Vec<StageInput> = (0..=MAX_STAGES)
        .map(|index| new_stage(&format!("Stage {index}")))
        .collect();
    let too_long = "x".repeat(MAX_STAGE_LABEL_CHARS + 1);
    let repeated = Uuid::now_v7();
    let cases: Vec<Vec<StageInput>> = vec![
        vec![],
        vec![new_stage("  ")],
        vec![new_stage("Lead"), new_stage("lead")],
        vec![new_stage(&too_long)],
        vec![keep(repeated, "A"), keep(repeated, "B")],
        too_many,
    ];
    for stages in cases {
        let store = MemoryStore::default();
        let err = service(CrmPermissionRole::Admin, store.clone())
            .replace_stages(&receipt_with_role(TeamRole::Owner), stages)
            .await
            .unwrap_err();
        assert!(matches!(err, CrmError::InvalidRequest(_)), "{err:?}");
        assert!(store.writes().is_empty());
    }
}

#[tokio::test]
async fn reset_deletes_the_definition() {
    let store = MemoryStore::customized(&["Lead"]);
    service(CrmPermissionRole::Admin, store.clone())
        .reset_stages(&receipt_with_role(TeamRole::Admin))
        .await
        .unwrap();
    assert_eq!(store.writes(), [Write::DeleteSet]);
    assert!(store.stage_ids().is_empty());
}

#[tokio::test]
async fn reset_on_defaults_is_a_no_op() {
    let store = MemoryStore::default();
    service(CrmPermissionRole::Admin, store.clone())
        .reset_stages(&receipt_with_role(TeamRole::Admin))
        .await
        .unwrap();
    assert!(store.writes().is_empty());
}

#[tokio::test]
async fn customizing_records_where_each_default_stage_went() {
    let store = MemoryStore::default();
    let settings = StubSettings::requiring(CrmPermissionRole::Admin);
    let set = CrmStageServiceImpl::new(settings.clone(), store)
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![new_stage("Lead"), new_stage("customer"), new_stage("Won")],
        )
        .await
        .unwrap();
    let legacy = settings.legacy();
    assert_eq!(legacy.len(), 2);
    assert_eq!(legacy[&StageOption::LEAD_UUID], set.stages[0].id);
    assert_eq!(legacy[&StageOption::CUSTOMER_UUID], set.stages[1].id);
}

#[tokio::test]
async fn renaming_a_seeded_stage_keeps_its_legacy_entry() {
    let store = MemoryStore::customized(&["Lead", "Customer"]);
    let [lead, customer] = store.stage_ids()[..] else {
        panic!("expected two seeded stages");
    };
    let legacy = BTreeMap::from([(StageOption::CUSTOMER_UUID, customer)]);
    let settings = StubSettings::requiring(CrmPermissionRole::Admin).with_legacy(legacy.clone());
    CrmStageServiceImpl::new(settings.clone(), store)
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(lead, "Lead"), keep(customer, "Client")],
        )
        .await
        .unwrap();
    assert!(settings.patches().is_empty());
    assert_eq!(settings.legacy(), legacy);
}

#[tokio::test]
async fn deleting_a_seeded_stage_leaves_the_map_alone() {
    let store = MemoryStore::customized(&["Lead", "Customer"]);
    let [lead, customer] = store.stage_ids()[..] else {
        panic!("expected two seeded stages");
    };
    let legacy = BTreeMap::from([
        (StageOption::LEAD_UUID, lead),
        (StageOption::CUSTOMER_UUID, customer),
    ]);
    let settings = StubSettings::requiring(CrmPermissionRole::Admin).with_legacy(legacy.clone());
    CrmStageServiceImpl::new(settings.clone(), store)
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(lead, "Lead")],
        )
        .await
        .unwrap();
    assert!(settings.patches().is_empty());
    assert_eq!(settings.legacy(), legacy);
}

#[tokio::test]
async fn a_set_without_a_map_gets_one_on_the_next_edit() {
    let store = MemoryStore::customized(&["Lead", "Client"]);
    let [lead, client] = store.stage_ids()[..] else {
        panic!("expected two seeded stages");
    };
    let settings = StubSettings::requiring(CrmPermissionRole::Admin);
    CrmStageServiceImpl::new(settings.clone(), store)
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(lead, "Lead"), keep(client, "Client")],
        )
        .await
        .unwrap();
    assert_eq!(
        settings.legacy(),
        BTreeMap::from([(StageOption::LEAD_UUID, lead)])
    );
}

#[tokio::test]
async fn a_backfilled_map_reads_labels_from_before_the_edit() {
    let store = MemoryStore::customized(&["Lead", "Client"]);
    let [lead, client] = store.stage_ids()[..] else {
        panic!("expected two seeded stages");
    };
    let settings = StubSettings::requiring(CrmPermissionRole::Admin);
    CrmStageServiceImpl::new(settings.clone(), store)
        .replace_stages(
            &receipt_with_role(TeamRole::Admin),
            vec![keep(lead, "Prospect"), keep(client, "Client")],
        )
        .await
        .unwrap();
    assert_eq!(
        settings.legacy(),
        BTreeMap::from([(StageOption::LEAD_UUID, lead)])
    );
}

#[tokio::test]
async fn reset_clears_legacy_ids() {
    let store = MemoryStore::customized(&["Lead"]);
    let [lead] = store.stage_ids()[..] else {
        panic!("expected one seeded stage");
    };
    let settings = StubSettings::requiring(CrmPermissionRole::Admin)
        .with_legacy(BTreeMap::from([(StageOption::LEAD_UUID, lead)]));
    CrmStageServiceImpl::new(settings.clone(), store)
        .reset_stages(&receipt_with_role(TeamRole::Admin))
        .await
        .unwrap();
    assert!(settings.legacy().is_empty());
}
