//! Pipeline workflows as an agent drives them: records and fields by name,
//! through the real pipeline, CRM and access services.
#![cfg(feature = "outbound")]

use crm::domain::{
    auth::CrmTeamReceipt,
    model::CrmError,
    pipeline_workflows::*,
    pipelines::{PipelineError, PipelineRecordType, PipelineServiceImpl, PipelineSharing},
    service::CrmServiceImpl,
    stages::*,
};
use crm::outbound::{
    companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
    pipelines::PgPipelineRepo,
};
use databases::domain::models::{DatabaseError, Viewer};
use databases::outbound::{
    gateway_event_publisher::NoOpTableEventPublisher, pg_cell_store::PgCellStore,
};
use databases::wiring::{PgDatabasesService, build_service};
use entity_access::{
    domain::{models::*, service::EntityAccessServiceImpl},
    outbound::PgAccessRepository,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use properties::PropertiesPgRepo;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

const OWNER: &str = "macro|workflow-owner@macro.com";
const MEMBER: &str = "macro|workflow-member@macro.com";
type Access = EntityAccessServiceImpl<PgAccessRepository>;
type DatabaseService = PgDatabasesService<NoOpTableEventPublisher, NoopMacroEventBroker, Access>;
type Pipelines = PipelineServiceImpl<
    PgPipelineRepo<PgCellStore<PropertiesPgRepo>>,
    DatabaseService,
    Access,
    Stages,
>;
type Crm = CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver>;
type Workflows = PipelineWorkflowServiceImpl<Pipelines, Crm, Access>;

/// The team's stage template: new pipelines copy it.
struct Stages;
impl StageDefinitionStore for Stages {
    async fn get_team_stage_set(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Option<TeamStageSet>, CrmError> {
        Ok(Some(TeamStageSet {
            definition_id: Uuid::nil(),
            stages: ["Prospect", "Demo", "Won"]
                .into_iter()
                .enumerate()
                .map(|(order, label)| TeamStage {
                    id: Uuid::nil(),
                    label: label.into(),
                    display_order: order as i32,
                })
                .collect(),
        }))
    }
    async fn create_team_stage_set(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: &[String],
    ) -> Result<TeamStageSet, CrmError> {
        unreachable!("workflows never edit the template")
    }
    async fn replace_stages(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: Uuid,
        _: StageReplacePlan,
    ) -> Result<TeamStageSet, CrmError> {
        unreachable!("workflows never edit the template")
    }
    async fn delete_team_stage_set(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: Uuid,
    ) -> Result<(), CrmError> {
        unreachable!("workflows never edit the template")
    }
}

fn viewer(id: &str) -> Viewer {
    Viewer {
        user_id: MacroUserIdStr::parse_from_str(id).unwrap().into_owned(),
        acting_bot: Some(bot_id::MACRO_AI_BOT_ID),
    }
}

struct Fixture {
    workflows: Workflows,
    acme: Uuid,
    globex: Uuid,
    sam: Uuid,
}

async fn fixture(pool: &PgPool) -> Fixture {
    for id in [OWNER, MEMBER] {
        let uid = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1,$2,$2,$2)",
            uid,
            id
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1,$1,$2)"#,
            id,
            uid
        )
        .execute(pool)
        .await
        .unwrap();
    }
    let team = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Sales', $2)",
        team,
        OWNER
    )
    .execute(pool)
    .await
    .unwrap();
    for id in [OWNER, MEMBER] {
        sqlx::query!(
            "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'member')",
            team,
            id
        )
        .execute(pool)
        .await
        .unwrap();
    }
    sqlx::query!(
        "INSERT INTO team_crm_settings (team_id, crm_enabled) VALUES ($1, true)",
        team
    )
    .execute(pool)
    .await
    .unwrap();
    let company = async |name: &str, domain: &str| {
        let id = Uuid::now_v7();
        sqlx::query!(
            "INSERT INTO crm_companies (id, team_id, custom_name, first_interaction, last_interaction)
             VALUES ($1, $2, $3, now(), now())",
            id,
            team,
            name
        )
        .execute(pool)
        .await
        .unwrap();
        sqlx::query!(
            "INSERT INTO crm_domains (company_id, team_id, domain) VALUES ($1, $2, $3)",
            id,
            team,
            domain
        )
        .execute(pool)
        .await
        .unwrap();
        id
    };
    let acme = company("Acme", "acme.com").await;
    let globex = company("Globex", "globex.com").await;
    let sam = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO crm_contacts (id, company_id, email, name, first_interaction, last_interaction)
         VALUES ($1, $2, 'sam@acme.com', 'Sam Lee', now(), now())",
        sam,
        acme
    )
    .execute(pool)
    .await
    .unwrap();

    let access = Arc::new(Access::new(PgAccessRepository::new(pool.clone())));
    let databases = Arc::new(build_service(
        pool.clone(),
        access.clone(),
        NoOpTableEventPublisher,
        NoopMacroEventBroker,
    ));
    let pipelines = Pipelines::new(
        PgPipelineRepo::new(
            pool.clone(),
            PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone())),
        ),
        databases,
        access.clone(),
        Stages,
    );
    let crm = Crm::new(
        CompaniesRepositoryImpl::new(pool.clone()),
        NoOpCompanyMetadataResolver,
    );
    Fixture {
        workflows: Workflows::new(Arc::new(pipelines), Arc::new(crm), access),
        acme,
        globex,
        sam,
    }
}

fn one(value: &str) -> FieldInput {
    FieldInput::One(value.into())
}

fn set(field: &str, value: &str) -> (String, FieldInput) {
    (field.into(), one(value))
}

fn field<'a>(entry: &'a PipelineEntryView, name: &str) -> Option<&'a FieldValue> {
    entry
        .fields
        .iter()
        .find(|(field, _)| field == name)
        .map(|(_, value)| value)
}

fn labels(value: &str) -> Option<FieldValue> {
    Some(FieldValue::Labels(vec![value.into()]))
}

async fn sales(workflows: &Workflows, sharing: PipelineSharing) -> PipelineOverview {
    workflows
        .create(
            &viewer(OWNER),
            NewPipeline {
                name: "Sales".into(),
                record_type: PipelineRecordType::Company,
                sharing,
                stages: Vec::new(),
                fields: Vec::new(),
            },
        )
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deals_are_added_found_moved_and_removed_by_name(pool: PgPool) {
    let Fixture {
        workflows,
        acme,
        globex,
        ..
    } = fixture(&pool).await;
    let owner = viewer(OWNER);
    let sales = sales(&workflows, PipelineSharing::Team).await;
    let id = sales.pipeline.pipeline.id;
    assert_eq!(
        sales
            .fields
            .iter()
            .map(|f| f.name.as_str())
            .collect::<Vec<_>>(),
        ["Company", "Stage", "Owner", "Revenue"]
    );

    let added = workflows
        .add(
            &owner,
            id,
            vec![
                EntryAddition {
                    record: RecordTarget::Id(acme),
                    set: vec![
                        set("stage", "prospect"),
                        set("Owner", "me"),
                        set("Revenue", "$48,000"),
                    ],
                },
                EntryAddition {
                    record: RecordTarget::Id(globex),
                    set: Vec::new(),
                },
            ],
            false,
        )
        .await
        .unwrap();
    assert_eq!(added.added.len(), 2);
    let acme_entry = &added.added[0];
    assert_eq!(acme_entry.record.name.as_deref(), Some("Acme"));
    assert_eq!(acme_entry.record.detail.as_deref(), Some("acme.com"));
    assert_eq!(field(acme_entry, "Stage"), labels("Prospect").as_ref());
    assert_eq!(
        field(acme_entry, "Owner"),
        Some(&FieldValue::References(vec![OWNER.into()]))
    );
    assert_eq!(
        field(acme_entry, "Revenue"),
        Some(&FieldValue::Number(48_000.0))
    );

    // A record already in the pipeline is reported, not added twice.
    let again = workflows
        .add(
            &owner,
            id,
            vec![EntryAddition {
                record: RecordTarget::Id(acme),
                set: Vec::new(),
            }],
            false,
        )
        .await
        .unwrap();
    assert!(again.added.is_empty());
    assert_eq!(again.already_present[0].entry_id, acme_entry.entry_id);

    let query = |filters, search: Option<&str>| EntryQuery {
        filters,
        search: search.map(Into::into),
        limit: 50,
        ..Default::default()
    };
    let prospects = workflows
        .find(&owner, id, query(vec![set("Stage", "Prospect")], None))
        .await
        .unwrap();
    assert_eq!(prospects.matched, 1);
    assert!(prospects.complete);
    assert_eq!(prospects.entries[0].record.id, acme);
    let all = workflows
        .find(&owner, id, query(Vec::new(), None))
        .await
        .unwrap();
    assert_eq!(all.matched, 2);
    let stages = all.counts.iter().find(|c| c.field == "Stage").unwrap();
    assert_eq!(
        stages.counts,
        [
            (String::from("Prospect"), 1),
            (String::from("Demo"), 0),
            (String::from("Won"), 0)
        ]
    );
    assert_eq!(stages.empty, 1);
    assert_eq!(all.totals, [(String::from("Revenue"), 48_000.0)]);
    let found = workflows
        .find(&owner, id, query(Vec::new(), Some("GLOB")))
        .await
        .unwrap();
    assert_eq!(found.entries.len(), 1);
    assert_eq!(found.entries[0].record.id, globex);
    let mine = workflows
        .find(&owner, id, query(vec![set("Owner", "me")], None))
        .await
        .unwrap();
    assert_eq!(mine.matched, 1);
    assert!(matches!(
        workflows.find(&owner, id, query(vec![set("Stage", "Closed")], None)).await,
        Err(WorkflowError::Invalid(message)) if message.contains("Prospect, Demo, Won")
    ));

    // Move Acme by the record it tracks; the change reports before and after.
    let moved = workflows
        .update(
            &owner,
            id,
            vec![EntryUpdate {
                target: EntryTarget::Record(acme),
                set: vec![set("Stage", "Won")],
            }],
            None,
        )
        .await
        .unwrap();
    let change = &moved.updated[0].changes[0];
    assert_eq!(change.before, labels("Prospect"));
    assert_eq!(change.after, labels("Won"));
    assert_eq!(moved.updated[0].record.name.as_deref(), Some("Acme"));
    // Every write is the user's, made by the agent acting for them.
    let changes = sqlx::query!(
        "SELECT actor, acting_bot FROM database_changes WHERE database_id = $1",
        sales.pipeline.pipeline.database_id.into_uuid()
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(!changes.is_empty());
    for change in changes {
        assert_eq!(change.actor.as_deref(), Some(OWNER));
        assert_eq!(change.acting_bot, Some(bot_id::MACRO_AI_BOT_ID.to_string()));
    }
    // A write based on a stale read is refused.
    assert!(matches!(
        workflows
            .update(
                &owner,
                id,
                vec![EntryUpdate {
                    target: EntryTarget::Record(acme),
                    set: vec![set("Stage", "Demo")],
                }],
                Some(all.pipeline.version),
            )
            .await,
        Err(WorkflowError::Pipeline(PipelineError::Database(
            DatabaseError::VersionConflict
        )))
    ));
    assert!(matches!(
        workflows
            .update(
                &owner,
                id,
                vec![EntryUpdate {
                    target: EntryTarget::Record(acme),
                    set: vec![set("Company", "anything")],
                }],
                None,
            )
            .await,
        Err(WorkflowError::Invalid(_))
    ));

    // The record's entries across pipelines, by id or by name.
    let everywhere = workflows.record_entries(&owner, &[acme]).await.unwrap();
    assert_eq!(everywhere.len(), 1);
    assert_eq!(
        field(&everywhere[0].entries[0], "Stage"),
        labels("Won").as_ref()
    );
    let by_name = workflows.search_entries(&owner, "acme", 50).await.unwrap();
    assert_eq!(by_name.len(), 1);
    assert_eq!(by_name[0].entries[0].record.id, acme);
    assert!(
        workflows
            .search_entries(&owner, "nobody", 50)
            .await
            .unwrap()
            .is_empty()
    );

    let removed = workflows
        .remove(&owner, id, vec![EntryTarget::Record(globex)])
        .await
        .unwrap();
    assert_eq!(removed.removed[0].record.id, globex);
    let left = workflows
        .find(&owner, id, query(Vec::new(), None))
        .await
        .unwrap();
    assert_eq!(left.matched, 1);
    assert!(matches!(
        workflows
            .update(
                &owner,
                id,
                vec![EntryUpdate {
                    target: EntryTarget::Record(globex),
                    set: vec![set("Stage", "Won")],
                }],
                None,
            )
            .await,
        Err(WorkflowError::Invalid(message)) if message.contains("AddToPipeline")
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn contacts_are_added_by_email_and_a_record_with_two_deals_needs_an_entry_id(pool: PgPool) {
    let Fixture {
        workflows,
        acme,
        sam,
        ..
    } = fixture(&pool).await;
    let owner = viewer(OWNER);
    let people = workflows
        .create(
            &owner,
            NewPipeline {
                name: "Partners".into(),
                record_type: PipelineRecordType::Contact,
                sharing: PipelineSharing::Private,
                stages: Vec::new(),
                fields: Vec::new(),
            },
        )
        .await
        .unwrap();
    let added = workflows
        .add(
            &owner,
            people.pipeline.pipeline.id,
            vec![EntryAddition {
                record: RecordTarget::Email("SAM@acme.com".into()),
                set: Vec::new(),
            }],
            false,
        )
        .await
        .unwrap();
    assert_eq!(added.added[0].record.id, sam);
    assert_eq!(added.added[0].record.name.as_deref(), Some("Sam Lee"));

    // In a company pipeline, a contact's email adds its company.
    let sales = sales(&workflows, PipelineSharing::Private).await;
    let id = sales.pipeline.pipeline.id;
    let email = || EntryAddition {
        record: RecordTarget::Email("sam@acme.com".into()),
        set: Vec::new(),
    };
    let added = workflows
        .add(&owner, id, vec![email()], false)
        .await
        .unwrap();
    assert_eq!(added.added[0].record.id, acme);
    let second = workflows
        .add(&owner, id, vec![email()], true)
        .await
        .unwrap();
    assert_eq!(second.added.len(), 1);
    assert!(matches!(
        workflows
            .update(
                &owner,
                id,
                vec![EntryUpdate {
                    target: EntryTarget::Record(acme),
                    set: vec![set("Stage", "Demo")],
                }],
                None,
            )
            .await,
        Err(WorkflowError::Invalid(message)) if message.contains("entryId")
    ));
    workflows
        .update(
            &owner,
            id,
            vec![EntryUpdate {
                target: EntryTarget::Entry(second.added[0].entry_id),
                set: vec![set("Stage", "Demo")],
            }],
            None,
        )
        .await
        .unwrap();
    assert!(matches!(
        workflows
            .add(
                &owner,
                id,
                vec![EntryAddition {
                    record: RecordTarget::Id(Uuid::now_v7()),
                    set: Vec::new(),
                }],
                false,
            )
            .await,
        Err(WorkflowError::Invalid(message)) if message.contains("ListCompanies")
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pipelines_are_created_with_stages_and_edited_by_name(pool: PgPool) {
    let Fixture { workflows, .. } = fixture(&pool).await;
    let owner = viewer(OWNER);
    let hiring = workflows
        .create(
            &owner,
            NewPipeline {
                name: "Hiring".into(),
                record_type: PipelineRecordType::Contact,
                sharing: PipelineSharing::Team,
                stages: vec!["Sourced".into(), "Interview".into(), "Hired".into()],
                fields: vec![
                    NewField {
                        name: "Notes".into(),
                        kind: NewFieldKind::Text,
                        options: Vec::new(),
                    },
                    NewField {
                        name: "Priority".into(),
                        kind: NewFieldKind::Select,
                        options: vec!["High".into(), "Low".into()],
                    },
                ],
            },
        )
        .await
        .unwrap();
    let id = hiring.pipeline.pipeline.id;
    let options = |overview: &PipelineOverview, name: &str| -> Vec<String> {
        overview
            .field(name)
            .unwrap()
            .options
            .iter()
            .map(|(_, label)| label.clone())
            .collect()
    };
    assert_eq!(options(&hiring, "Stage"), ["Sourced", "Interview", "Hired"]);
    assert_eq!(options(&hiring, "Priority"), ["High", "Low"]);

    let edited = workflows
        .edit(
            &owner,
            id,
            PipelineEdit {
                name: Some("Hiring 2026".into()),
                rename_fields: vec![("notes".into(), "Summary".into())],
                add_options: vec![("Stage".into(), vec!["Offer".into()])],
                rename_options: vec![("Stage".into(), "hired".into(), "Joined".into())],
                remove_options: vec![("Stage".into(), "Interview".into())],
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(edited.pipeline.pipeline.name, "Hiring 2026");
    assert_eq!(options(&edited, "Stage"), ["Sourced", "Joined", "Offer"]);
    assert!(edited.field("Summary").is_ok());
    assert!(matches!(
        workflows
            .edit(
                &owner,
                id,
                PipelineEdit {
                    remove_fields: vec!["Contact".into()],
                    ..Default::default()
                },
            )
            .await,
        Err(WorkflowError::Invalid(_))
    ));

    // A team member may edit a shared pipeline, but only its owner shares it.
    let member = viewer(MEMBER);
    assert_eq!(workflows.pipelines(&member).await.unwrap().len(), 1);
    assert!(matches!(
        workflows
            .edit(
                &member,
                id,
                PipelineEdit {
                    name: Some("Renamed by a member".into()),
                    add_options: vec![("Stage".into(), vec!["Rejected".into()])],
                    sharing: Some(PipelineSharing::Private),
                    ..Default::default()
                },
            )
            .await,
        Err(WorkflowError::Invalid(message)) if message.contains("owner")
    ));
    // The refusal comes before any write: nothing of that edit landed.
    let unchanged = &workflows.pipelines(&member).await.unwrap()[0];
    assert_eq!(unchanged.pipeline.pipeline.name, "Hiring 2026");
    assert_eq!(options(unchanged, "Stage"), ["Sourced", "Joined", "Offer"]);
    workflows
        .edit(
            &owner,
            id,
            PipelineEdit {
                sharing: Some(PipelineSharing::Private),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert!(workflows.pipelines(&member).await.unwrap().is_empty());
    assert!(
        workflows
            .find(&member, id, EntryQuery::default())
            .await
            .is_err()
    );
}
