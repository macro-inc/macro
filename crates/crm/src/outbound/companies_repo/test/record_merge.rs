//! Company merges through the Postgres repository and the real owners of the
//! rows a merge moves: properties, pipelines, discussions, favorites, lists,
//! activity and teammates' sharing rules.

use std::sync::Arc;

use databases::domain::models::Viewer;
use databases::outbound::{
    gateway_event_publisher::NoOpTableEventPublisher, pg_cell_store::PgCellStore,
};
use databases::wiring::{PgDatabasesService, build_service};
use entity_access::{
    domain::models::MemberTeamRole, domain::service::EntityAccessServiceImpl,
    outbound::PgAccessRepository,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_event_broker::NoopMacroEventBroker;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use properties::PropertiesPgRepo;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::helpers::*;
use crate::domain::auth::CrmTeamReceipt;
use crate::domain::email_rules::{EmailInclusionRule, EmailRuleSet};
use crate::domain::model::CrmError;
use crate::domain::pipeline_workflows::*;
use crate::domain::pipelines::{PipelineRecordType, PipelineServiceImpl, PipelineSharing};
use crate::domain::record_merge::{
    MergeBlock, MergeCommand, MergeError, MergeRecordType, MergeScope, MergeTargets,
    SharingRulesChoice, service::RecordMergeRepository,
};
use crate::domain::service::CrmServiceImpl;
use crate::domain::stages::{StageDefinitionStore, StageReplacePlan, TeamStage, TeamStageSet};
use crate::outbound::{
    companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
    pipelines::PgPipelineRepo, record_merge::PgRecordMergeRepository,
};

const OWNER: &str = "macro|merge-owner@example.com";
const SHARER: &str = "macro|merge-sharer@example.com";

type Access = EntityAccessServiceImpl<PgAccessRepository>;
type Databases = PgDatabasesService<NoOpTableEventPublisher, NoopMacroEventBroker, Access>;
type Pipelines =
    PipelineServiceImpl<PgPipelineRepo<PgCellStore<PropertiesPgRepo>>, Databases, Access, Stages>;
type Workflows = PipelineWorkflowServiceImpl<
    Pipelines,
    CrmServiceImpl<CompaniesRepositoryImpl, NoOpCompanyMetadataResolver>,
    Access,
>;

struct Stages;

impl StageDefinitionStore for Stages {
    async fn get_team_stage_set(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Option<TeamStageSet>, CrmError> {
        Ok(Some(TeamStageSet {
            definition_id: Uuid::nil(),
            stages: vec![TeamStage {
                id: Uuid::nil(),
                label: "Lead".into(),
                display_order: 0,
            }],
        }))
    }
    async fn create_team_stage_set(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: &[String],
    ) -> Result<TeamStageSet, CrmError> {
        unreachable!()
    }
    async fn replace_stages(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: Uuid,
        _: StageReplacePlan,
    ) -> Result<TeamStageSet, CrmError> {
        unreachable!()
    }
    async fn delete_team_stage_set(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: Uuid,
    ) -> Result<(), CrmError> {
        unreachable!()
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

struct World {
    pool: PgPool,
    team: Uuid,
    merges: PgRecordMergeRepository<Databases>,
    workflows: Workflows,
}

impl World {
    async fn new(pool: PgPool) -> Self {
        let team = Uuid::now_v7();
        seed_team(&pool, team, OWNER).await.unwrap();
        enable_crm_for_team(&pool, team).await.unwrap();
        sqlx::query("INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'admin')")
            .bind(team)
            .bind(OWNER)
            .execute(&pool)
            .await
            .unwrap();
        let access = Arc::new(Access::new(PgAccessRepository::new(pool.clone())));
        let databases = Arc::new(build_service(
            pool.clone(),
            access.clone(),
            NoOpTableEventPublisher,
            NoopMacroEventBroker,
        ));
        let pipelines = Arc::new(Pipelines::new(
            PgPipelineRepo::new(
                pool.clone(),
                PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone())),
            ),
            databases.clone(),
            access.clone(),
            Stages,
        ));
        let crm = Arc::new(CrmServiceImpl::new(
            CompaniesRepositoryImpl::new(pool.clone()),
            NoOpCompanyMetadataResolver,
        ));
        Self {
            merges: PgRecordMergeRepository::new(pool.clone(), databases),
            workflows: Workflows::new(pipelines, crm, access),
            pool,
            team,
        }
    }

    fn scope(&self) -> MergeScope {
        MergeScope {
            team_id: self.team,
            actor: user(OWNER),
        }
    }

    async fn company(&self, name: &str, email_sync: bool, domains: &[&str]) -> Uuid {
        let id = insert_company(&self.pool, self.team, email_sync, domains)
            .await
            .unwrap();
        sqlx::query("UPDATE crm_companies SET custom_name = $2 WHERE id = $1")
            .bind(id)
            .bind(name)
            .execute(&self.pool)
            .await
            .unwrap();
        id
    }

    async fn person(&self, company: Uuid, email: &str, archived: bool) -> Uuid {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO crm_contacts (id, team_id, company_id, email, hidden, first_interaction, last_interaction)
             VALUES ($1, $2, $3, $4, $5, now(), now())",
        )
        .bind(id)
        .bind(self.team)
        .bind(company)
        .bind(email)
        .bind(archived)
        .execute(&self.pool)
        .await
        .unwrap();
        id
    }

    async fn definition(&self, name: &str, personal: bool) -> Uuid {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO property_definitions (id, display_name, data_type, is_multi_select, team_id, user_id)
             VALUES ($1, $2, 'STRING', false, $3, $4)",
        )
        .bind(id)
        .bind(name)
        .bind((!personal).then_some(self.team))
        .bind(personal.then_some(OWNER))
        .execute(&self.pool)
        .await
        .unwrap();
        id
    }

    async fn value(
        &self,
        entity_id: &str,
        entity_type: &str,
        definition: Uuid,
        values: Value,
    ) -> Uuid {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
             VALUES ($1, $2, $3::property_entity_type, $4, $5)",
        )
        .bind(id)
        .bind(entity_id)
        .bind(entity_type)
        .bind(definition)
        .bind(values)
        .execute(&self.pool)
        .await
        .unwrap();
        id
    }

    /// A teammate who shares only the mail their rules select.
    async fn sharer(&self, rules: &EmailRuleSet) {
        let macro_user = Uuid::now_v7();
        sqlx::query("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)")
            .bind(macro_user)
            .bind(SHARER)
            .execute(&self.pool)
            .await
            .unwrap();
        sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
            .bind(SHARER)
            .bind(macro_user)
            .execute(&self.pool)
            .await
            .unwrap();
        let link = insert_email_link(&self.pool, SHARER, "merge-sharer@example.com")
            .await
            .unwrap();
        consent_to_mailbox(&self.pool, self.team, link)
            .await
            .unwrap();
        let mut tx = self.pool.begin().await.unwrap();
        let revision =
            CompaniesRepositoryImpl::insert_rule_revision(&mut tx, self.team, SHARER, link, rules)
                .await
                .unwrap();
        sqlx::query(
            "UPDATE crm_email_consent SET enabled = FALSE WHERE team_id = $1 AND user_id = $2",
        )
        .bind(self.team)
        .bind(SHARER)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE crm_email_consent SET mode = 'selected', selected_enabled = TRUE, active_rule_revision = $3
             WHERE team_id = $1 AND user_id = $2",
        )
        .bind(self.team)
        .bind(SHARER)
        .bind(revision)
        .execute(&mut *tx)
        .await
        .unwrap();
        tx.commit().await.unwrap();
    }

    async fn active_rules(&self) -> (i64, EmailRuleSet) {
        let (revision, definition): (i64, Value) = sqlx::query_as(
            "SELECT r.revision, r.definition FROM crm_email_consent c
             JOIN crm_email_rule_revisions r ON r.team_id = c.team_id AND r.user_id = c.user_id AND r.revision = c.active_rule_revision
             WHERE c.team_id = $1 AND c.user_id = $2",
        )
        .bind(self.team)
        .bind(SHARER)
        .fetch_one(&self.pool)
        .await
        .unwrap();
        (revision, serde_json::from_value(definition).unwrap())
    }

    async fn merge(
        &self,
        targets: &MergeTargets,
        sharing_rules: SharingRulesChoice,
    ) -> Result<crate::domain::record_merge::MergeOutcome, MergeError> {
        let preview = self.merges.preview(&self.scope(), targets).await?;
        self.merges
            .commit(
                &self.scope(),
                &MergeCommand {
                    targets: targets.clone(),
                    revision: preview.revision,
                    request_key: Uuid::now_v7(),
                    sharing_rules,
                },
            )
            .await
            .map(|committed| committed.outcome)
    }

    async fn scalar<T>(&self, sql: &str, id: Uuid) -> T
    where
        T: for<'r> sqlx::Decode<'r, sqlx::Postgres> + sqlx::Type<sqlx::Postgres> + Send + Unpin,
    {
        sqlx::query_scalar(sql)
            .bind(id)
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }
}

fn targets(survivor: Uuid, sources: &[Uuid]) -> MergeTargets {
    MergeTargets::new(MergeRecordType::Company, survivor, sources.iter().copied()).unwrap()
}

fn text(value: &str) -> Value {
    json!({"type": "String", "value": value})
}

fn refs(ids: &[Uuid]) -> Value {
    json!({
        "type": "EntityReference",
        "value": ids.iter().map(|id| json!({"entity_type": "COMPANY", "entity_id": id.to_string()})).collect::<Vec<_>>(),
    })
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_merge_moves_everything_that_names_the_merged_companies_to_the_one_that_stays(
    pool: PgPool,
) {
    let world = World::new(pool.clone()).await;
    let stays = world
        .company(
            "Wrenmoor University",
            true,
            &["wrenmoor-university.example.com"],
        )
        .await;
    let merged = world
        .company("Wrenmoor Univ.", true, &["wrenmoor.example.com"])
        .await;
    let alumni = world
        .company("Wrenmoor Alumni", false, &["wrenmoor-alumni.example.com"])
        .await;
    let staying_person = world
        .person(stays, "dean@wrenmoor-university.example.com", false)
        .await;
    let moving_person = world
        .person(merged, "pat@wrenmoor.example.com", false)
        .await;
    let archived_person = world
        .person(alumni, "old@wrenmoor-alumni.example.com", true)
        .await;

    let tier = world.definition("Tier", false).await;
    let notes = world.definition("My notes", true).await;
    world
        .value(&stays.to_string(), "COMPANY", tier, text("Gold"))
        .await;
    world
        .value(&merged.to_string(), "COMPANY", tier, text("Silver"))
        .await;
    world
        .value(&stays.to_string(), "COMPANY", notes, text("keep"))
        .await;
    world
        .value(&merged.to_string(), "COMPANY", notes, text("private"))
        .await;
    let revenue = world
        .value(
            &alumni.to_string(),
            "COMPANY",
            "00000001-0000-0000-0000-000000000012".parse().unwrap(),
            json!({"type": "Number", "value": 5}),
        )
        .await;
    let task_link = world
        .value(
            "task-1",
            "DOCUMENT",
            "00000001-0000-0000-0000-00000000000c".parse().unwrap(),
            refs(&[merged, stays]),
        )
        .await;

    let owner = Viewer {
        user_id: user(OWNER),
        acting_bot: None,
    };
    let pipeline = world
        .workflows
        .create(
            &owner,
            NewPipeline {
                name: "Deals".into(),
                record_type: Some(PipelineRecordType::Company),
                sharing: PipelineSharing::Team,
                stages: Vec::new(),
                fields: Vec::new(),
            },
        )
        .await
        .unwrap()
        .pipeline
        .pipeline;
    for company in [stays, merged] {
        world
            .workflows
            .add(
                &owner,
                pipeline.id,
                vec![EntryAddition {
                    record: Some(RecordTarget::Id(company)),
                    set: Vec::new(),
                }],
                false,
            )
            .await
            .unwrap();
    }
    let version_before: i64 = world
        .scalar(
            "SELECT version FROM database_tables WHERE id = $1",
            pipeline.table_id.into_uuid(),
        )
        .await;

    let root = Uuid::now_v7();
    for (id, thread) in [(root, None), (Uuid::now_v7(), Some(root))] {
        sqlx::query(
            "INSERT INTO comms_messages (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content)
             VALUES ($1, 'crm_company', $2, $3, $4, 'note')",
        )
        .bind(id)
        .bind(merged.to_string())
        .bind(thread)
        .bind(OWNER)
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query(
        "INSERT INTO favorite (user_id, entity_type, entity_id) VALUES ($1, 'crm_company', $2)",
    )
    .bind(OWNER)
    .bind(merged.to_string())
    .execute(&pool)
    .await
    .unwrap();
    let list = Uuid::now_v7();
    sqlx::query("INSERT INTO saved_view (id, user_id, name, config, updated_at) VALUES ($1, $2, 'Prospects', $3, now())")
        .bind(list)
        .bind(OWNER)
        .bind(json!({"kind": "crm-list", "teamId": world.team, "companyIds": [alumni.to_string(), stays.to_string()]}))
        .execute(&pool)
        .await
        .unwrap();
    world
        .sharer(&EmailRuleSet {
            schema_version: 1,
            include: vec![
                EmailInclusionRule::Company { company_id: merged },
                EmailInclusionRule::Domain {
                    domain: "partner.example.net".into(),
                },
            ],
        })
        .await;
    let (revision_before, _) = world.active_rules().await;

    let merge = targets(stays, &[merged, alumni]);
    let preview = world.merges.preview(&world.scope(), &merge).await.unwrap();
    assert_eq!(preview.survivor.name, "Wrenmoor University");
    assert_eq!(
        preview.identifiers[0], "wrenmoor-university.example.com",
        "the survivor's primary domain stays first"
    );
    let mut identifiers = preview.identifiers.clone();
    identifiers.sort();
    assert_eq!(
        identifiers,
        [
            "wrenmoor-alumni.example.com",
            "wrenmoor-university.example.com",
            "wrenmoor.example.com"
        ]
        .map(String::from)
    );
    assert_eq!(preview.moves.contacts, 2);
    assert_eq!(preview.moves.pipeline_entries, 1);
    assert_eq!(preview.moves.references, 1);
    assert_eq!(preview.moves.discussion_messages, 2);
    assert_eq!(
        preview.shared_pipelines.len(),
        1,
        "two deals in one pipeline stay two"
    );
    assert_eq!(preview.shared_pipelines[0].entries_after, 2);
    assert_eq!(
        preview.conflicts.len(),
        1,
        "only the team-visible difference is shown"
    );
    assert_eq!(preview.conflicts[0].property_id, tier);
    assert_eq!(
        preview.email_sync.kept_out,
        vec!["wrenmoor-alumni.example.com".to_string()]
    );
    let sharing = preview.sharing_rules.clone().unwrap();
    assert_eq!((sharing.teammates, sharing.keep_fits), (1, true));
    assert!(preview.blocked.is_none());

    let outcome = world
        .merges
        .commit(
            &world.scope(),
            &MergeCommand {
                targets: merge.clone(),
                revision: preview.revision.clone(),
                request_key: Uuid::now_v7(),
                sharing_rules: SharingRulesChoice::Keep,
            },
        )
        .await
        .unwrap();
    assert!(!outcome.replayed);
    let merge_id = outcome.outcome.merge_id;

    // CRM's own rows.
    let primary: String = world
        .scalar(
            "SELECT domain FROM crm_domains WHERE company_id = $1 ORDER BY created_at, id LIMIT 1",
            stays,
        )
        .await;
    assert_eq!(primary, "wrenmoor-university.example.com");
    let domains: i64 = world
        .scalar(
            "SELECT count(*) FROM crm_domains WHERE company_id = $1",
            stays,
        )
        .await;
    assert_eq!(domains, 3);
    for person in [staying_person, moving_person, archived_person] {
        let company: Uuid = world
            .scalar("SELECT company_id FROM crm_contacts WHERE id = $1", person)
            .await;
        assert_eq!(company, stays);
    }
    let archived: bool = world
        .scalar(
            "SELECT hidden FROM crm_contacts WHERE id = $1",
            archived_person,
        )
        .await;
    assert!(archived, "people keep their own archive state");
    let blocked: i64 = world.scalar("SELECT count(*) FROM crm_blocked_domains WHERE team_id = $1 AND domain = 'wrenmoor-alumni.example.com'", world.team).await;
    assert_eq!(blocked, 1, "mail that was kept out stays out");
    let left: i64 = world
        .scalar(
            "SELECT count(*) FROM crm_companies WHERE id = ANY(ARRAY[$1])",
            merged,
        )
        .await;
    assert_eq!(left, 0);
    for old in [merged, alumni] {
        let current: Uuid = world
            .scalar(
                "SELECT company_id FROM crm_company_aliases WHERE retired_id = $1",
                old,
            )
            .await;
        assert_eq!(current, stays);
    }

    // Properties: the survivor's values win, a value it lacked moves with
    // its row, references name it once.
    let tier_now: Value = sqlx::query_scalar(
        "SELECT values FROM entity_properties WHERE entity_id = $1 AND property_definition_id = $2",
    )
    .bind(stays.to_string())
    .bind(tier)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(tier_now, text("Gold"));
    let revenue_owner: String = world
        .scalar(
            "SELECT entity_id FROM entity_properties WHERE id = $1",
            revenue,
        )
        .await;
    assert_eq!(revenue_owner, stays.to_string());
    let source_values: i64 =
        sqlx::query_scalar("SELECT count(*) FROM entity_properties WHERE entity_id = ANY($1)")
            .bind(vec![merged.to_string(), alumni.to_string()])
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(source_values, 0);
    let link_now: Value = world
        .scalar(
            "SELECT values FROM entity_properties WHERE id = $1",
            task_link,
        )
        .await;
    assert_eq!(link_now, refs(&[stays]));

    // Pipelines: both deals now name the survivor, through a journaled write.
    let entries: Vec<Value> = sqlx::query_scalar(
        "SELECT ep.values FROM entity_properties ep JOIN database_rows r ON r.id::text = ep.entity_id
         JOIN database_columns c ON c.table_id = r.table_id AND c.property_definition_id = ep.property_definition_id
         WHERE r.table_id = $1 AND c.id = $2 ORDER BY r.position",
    )
    .bind(pipeline.table_id.into_uuid())
    .bind(pipeline.primary_column_id.into_uuid())
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(entries.len(), 2);
    for entry in &entries {
        let named: Vec<&str> = entry["value"]
            .as_array()
            .unwrap()
            .iter()
            .map(|reference| reference["entity_id"].as_str().unwrap())
            .collect();
        assert_eq!(named, vec![stays.to_string().as_str()]);
    }
    let version_after: i64 = world
        .scalar(
            "SELECT version FROM database_tables WHERE id = $1",
            pipeline.table_id.into_uuid(),
        )
        .await;
    assert_eq!(version_after, version_before + 1);
    let journaled: i64 = world.scalar("SELECT count(*) FROM database_changes WHERE table_id = $1 AND version = (SELECT version FROM database_tables WHERE id = $1)", pipeline.table_id.into_uuid()).await;
    assert_eq!(journaled, 1);

    // Discussions, favorites and lists.
    let moved: i64 = world
        .scalar(
            "SELECT count(*) FROM comms_messages WHERE crm_company_message_parent_id = $1",
            stays,
        )
        .await;
    assert_eq!(moved, 2);
    let favorite: String = sqlx::query_scalar("SELECT entity_id FROM favorite WHERE user_id = $1")
        .bind(OWNER)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(favorite, stays.to_string());
    let list_now: Value = world
        .scalar("SELECT config FROM saved_view WHERE id = $1", list)
        .await;
    assert_eq!(list_now["companyIds"], json!([stays.to_string()]));

    // The teammate shares exactly the mail they shared, as domains, never
    // through the survivor; their history says why.
    let (revision_after, rules) = world.active_rules().await;
    assert_eq!(revision_after, revision_before + 1);
    let mut expected = vec![
        EmailInclusionRule::Domain {
            domain: "partner.example.net".into(),
        },
        EmailInclusionRule::Domain {
            domain: "wrenmoor.example.com".into(),
        },
    ];
    expected.sort();
    assert_eq!(rules.include, expected);
    let (action, actor, details): (String, String, Value) = sqlx::query_as(
        "SELECT action, actor_kind, details FROM crm_email_policy_audit WHERE team_id = $1 AND user_id = $2 ORDER BY event_id DESC LIMIT 1",
    )
    .bind(world.team)
    .bind(SHARER)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (action.as_str(), actor.as_str()),
        ("records_merged", "system")
    );
    assert_eq!(details["merge_id"], json!(merge_id));

    // One activity entry on the survivor, with only the team-visible value.
    let (action, payload): (String, Value) = sqlx::query_as(
        "SELECT action, action_payload FROM activity_events WHERE entity_type = 'crm_company' AND entity_id = $1",
    )
    .bind(stays.to_string())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(action, "record_merged");
    assert_eq!(payload["dropped"].as_array().unwrap().len(), 1);
    assert!(
        !payload.to_string().contains("private"),
        "a private value never reaches activity"
    );

    // The log keeps every changed row, the private value included.
    let logged: Vec<(String, String)> =
        sqlx::query_as("SELECT owner, table_name FROM crm_merge_changes WHERE merge_id = $1")
            .bind(merge_id)
            .fetch_all(&pool)
            .await
            .unwrap();
    for (owner, table) in [
        ("crm", "crm_domains"),
        ("crm", "crm_contacts"),
        ("crm", "crm_companies"),
        ("crm", "crm_email_consent"),
        ("properties", "entity_properties"),
        ("properties", "dropped_value"),
        ("databases", "entity_properties"),
        ("messages", "comms_messages"),
        ("favorites", "favorite"),
        ("saved_views", "saved_view"),
    ] {
        assert!(
            logged.iter().any(|(o, t)| o == owner && t == table),
            "{owner}.{table} is logged"
        );
    }
    let private_logged: i64 = world.scalar("SELECT count(*) FROM crm_merge_changes WHERE merge_id = $1 AND previous::text LIKE '%private%'", merge_id).await;
    assert!(private_logged >= 1);
    // The survivor favorite the merge created is logged as new, so undoing
    // the merge can tell it from one the user already had.
    let created_favorite: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM crm_merge_changes WHERE merge_id = $1 AND table_name = 'favorite'
           AND row_key->>'entity_id' = $2 AND previous = 'null'::jsonb",
    )
    .bind(merge_id)
    .bind(stays.to_string())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(created_favorite, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stopping_sharing_removes_the_rule_without_pointing_it_at_the_survivor(pool: PgPool) {
    let world = World::new(pool).await;
    let stays = world
        .company("Fenlark Health", true, &["fenlark.example.com"])
        .await;
    let merged = world
        .company("Fenlark", true, &["fenlark-health.example.com"])
        .await;
    world
        .sharer(&EmailRuleSet {
            schema_version: 1,
            include: vec![EmailInclusionRule::Company { company_id: merged }],
        })
        .await;

    world
        .merge(&targets(stays, &[merged]), SharingRulesChoice::Stop)
        .await
        .unwrap();
    let (_, rules) = world.active_rules().await;
    assert!(rules.include.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_retry_returns_the_first_result_and_a_changed_review_is_refused(pool: PgPool) {
    let world = World::new(pool.clone()).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    let other = world.company("Other", true, &["other.example.com"]).await;

    let merge = targets(stays, &[merged]);
    let preview = world.merges.preview(&world.scope(), &merge).await.unwrap();
    let command = MergeCommand {
        targets: merge.clone(),
        revision: preview.revision.clone(),
        request_key: Uuid::now_v7(),
        sharing_rules: SharingRulesChoice::Keep,
    };

    // A person filed after the review changes what it showed.
    world.person(merged, "late@merged.example.com", false).await;
    assert!(matches!(
        world.merges.commit(&world.scope(), &command).await,
        Err(MergeError::PreviewStale)
    ));

    let preview = world.merges.preview(&world.scope(), &merge).await.unwrap();
    let command = MergeCommand {
        revision: preview.revision,
        ..command
    };
    let first = world.merges.commit(&world.scope(), &command).await.unwrap();
    let again = world.merges.commit(&world.scope(), &command).await.unwrap();
    assert!(again.replayed);
    assert_eq!(again.outcome, first.outcome);
    let merges: i64 = world
        .scalar(
            "SELECT count(*) FROM crm_merges WHERE team_id = $1",
            world.team,
        )
        .await;
    assert_eq!(merges, 1);

    let reused = MergeCommand {
        targets: targets(stays, &[other]),
        ..command
    };
    assert!(matches!(
        world.merges.commit(&world.scope(), &reused).await,
        Err(MergeError::RequestReused)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn people_sharing_an_address_across_companies_block_the_merge(pool: PgPool) {
    let world = World::new(pool).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    world.person(stays, "pat@shared.example.com", false).await;
    let archived = world.person(merged, "pat@shared.example.com", true).await;

    let merge = targets(stays, &[merged]);
    let preview = world.merges.preview(&world.scope(), &merge).await.unwrap();
    let Some(MergeBlock::SameAddressPeople { people }) = preview.blocked.clone() else {
        panic!("expected the same-address block");
    };
    assert!(
        people
            .iter()
            .any(|person| person.contact_id == archived && person.archived)
    );
    let refused = world
        .merges
        .commit(
            &world.scope(),
            &MergeCommand {
                targets: merge,
                revision: preview.revision,
                request_key: Uuid::now_v7(),
                sharing_rules: SharingRulesChoice::Keep,
            },
        )
        .await;
    assert!(matches!(
        refused,
        Err(MergeError::Conflict(MergeBlock::SameAddressPeople { .. }))
    ));
    let left: i64 = world
        .scalar("SELECT count(*) FROM crm_companies WHERE id = $1", merged)
        .await;
    assert_eq!(left, 1, "nothing is written");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn archived_foreign_and_merged_companies_are_refused(pool: PgPool) {
    let world = World::new(pool.clone()).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let archived = world
        .company("Archived", true, &["archived.example.com"])
        .await;
    sqlx::query("UPDATE crm_companies SET hidden = TRUE WHERE id = $1")
        .bind(archived)
        .execute(&pool)
        .await
        .unwrap();
    assert!(matches!(
        world.merges.preview(&world.scope(), &targets(stays, &[archived])).await,
        Err(MergeError::RecordHidden(id)) if id == archived
    ));

    let elsewhere = Uuid::now_v7();
    seed_team(&pool, elsewhere, "macro|elsewhere@example.com")
        .await
        .unwrap();
    let foreign = insert_company(&pool, elsewhere, true, &["foreign.example.com"])
        .await
        .unwrap();
    assert!(matches!(
        world
            .merges
            .preview(&world.scope(), &targets(stays, &[foreign]))
            .await,
        Err(MergeError::RecordUnavailable)
    ));

    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    world
        .merge(&targets(stays, &[merged]), SharingRulesChoice::Keep)
        .await
        .unwrap();
    let third = world.company("Third", true, &["third.example.com"]).await;
    assert!(matches!(
        world.merges.preview(&world.scope(), &targets(third, &[merged])).await,
        Err(MergeError::AlreadyMerged { record_id, current_id }) if record_id == merged && current_id == stays
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn merging_the_survivor_again_points_every_old_id_at_the_last_one(pool: PgPool) {
    let world = World::new(pool).await;
    let first = world.company("First", true, &["first.example.com"]).await;
    let second = world.company("Second", true, &["second.example.com"]).await;
    let last = world.company("Last", true, &["last.example.com"]).await;

    world
        .merge(&targets(second, &[first]), SharingRulesChoice::Keep)
        .await
        .unwrap();
    world
        .merge(&targets(last, &[second]), SharingRulesChoice::Keep)
        .await
        .unwrap();
    for old in [first, second] {
        let current: Uuid = world
            .scalar(
                "SELECT company_id FROM crm_company_aliases WHERE retired_id = $1",
                old,
            )
            .await;
        assert_eq!(current, last);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn keeping_a_rule_set_past_the_limit_is_refused_but_stopping_works(pool: PgPool) {
    let world = World::new(pool).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let many: Vec<String> = (0..20)
        .map(|n| format!("d{n}.merged.example.com"))
        .collect();
    let many: Vec<&str> = many.iter().map(String::as_str).collect();
    let merged = world.company("Merged", true, &many).await;
    let mut include: Vec<EmailInclusionRule> = (0
        ..crate::domain::email_rules::MAX_EMAIL_INCLUSION_RULES - 1)
        .map(|n| EmailInclusionRule::Domain {
            domain: format!("r{n}.example.net"),
        })
        .collect();
    include.push(EmailInclusionRule::Company { company_id: merged });
    world
        .sharer(&EmailRuleSet {
            schema_version: 1,
            include,
        })
        .await;

    let merge = targets(stays, &[merged]);
    let preview = world.merges.preview(&world.scope(), &merge).await.unwrap();
    assert!(!preview.sharing_rules.unwrap().keep_fits);
    assert!(matches!(
        world.merge(&merge, SharingRulesChoice::Keep).await,
        Err(MergeError::SharingRulesTooLarge)
    ));
    world.merge(&merge, SharingRulesChoice::Stop).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn opposing_merges_at_once_commit_one_and_refuse_the_other(pool: PgPool) {
    let world = Arc::new(World::new(pool.clone()).await);
    let first = world.company("First", true, &["first.example.com"]).await;
    let second = world.company("Second", true, &["second.example.com"]).await;

    let commands = [targets(first, &[second]), targets(second, &[first])];
    let mut reviewed = Vec::new();
    for merge in &commands {
        let preview = world.merges.preview(&world.scope(), merge).await.unwrap();
        reviewed.push(MergeCommand {
            targets: merge.clone(),
            revision: preview.revision,
            request_key: Uuid::now_v7(),
            sharing_rules: SharingRulesChoice::Keep,
        });
    }
    let runs = reviewed.into_iter().map(|command| {
        let world = world.clone();
        tokio::spawn(async move { world.merges.commit(&world.scope(), &command).await })
    });
    let results: Vec<_> = futures::future::join_all(runs)
        .await
        .into_iter()
        .map(|joined| joined.unwrap())
        .collect();

    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert!(results.iter().any(|result| matches!(
        result,
        Err(MergeError::AlreadyMerged { .. } | MergeError::RecordUnavailable)
    )));
    let companies: i64 =
        sqlx::query_scalar("SELECT count(*) FROM crm_companies WHERE id = ANY($1)")
            .bind(vec![first, second])
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(companies, 1, "exactly one company stays");
    let aliases: i64 = world
        .scalar(
            "SELECT count(*) FROM crm_company_aliases WHERE company_id = $1 OR retired_id = $1",
            first,
        )
        .await;
    assert_eq!(aliases, 1, "no alias points both ways");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_admin_demoted_after_the_review_cannot_commit_it(pool: PgPool) {
    let world = World::new(pool.clone()).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    let merge = targets(stays, &[merged]);
    let preview = world.merges.preview(&world.scope(), &merge).await.unwrap();

    sqlx::query("UPDATE team_user SET team_role = 'member' WHERE team_id = $1 AND user_id = $2")
        .bind(world.team)
        .bind(OWNER)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        matches!(
            world
                .merges
                .preview(&world.scope(), &targets(stays, &[merged]))
                .await,
            Err(MergeError::PermissionRequired)
        ),
        "nor can they review it again"
    );
    let command = MergeCommand {
        targets: merge,
        revision: preview.revision,
        request_key: Uuid::now_v7(),
        sharing_rules: SharingRulesChoice::Keep,
    };
    assert!(matches!(
        world.merges.commit(&world.scope(), &command).await,
        Err(MergeError::PermissionRequired)
    ));
    let left: i64 = world
        .scalar("SELECT count(*) FROM crm_companies WHERE id = $1", merged)
        .await;
    assert_eq!(left, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_merge_log_records_each_new_old_id(pool: PgPool) {
    let world = World::new(pool).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;

    let outcome = world
        .merge(&targets(stays, &[merged]), SharingRulesChoice::Keep)
        .await
        .unwrap();

    let logged: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM crm_merge_changes
         WHERE merge_id = $1 AND table_name = 'crm_company_aliases'
           AND row_key = jsonb_build_object('retired_id', $2::uuid) AND previous = 'null'::jsonb",
    )
    .bind(outcome.merge_id)
    .bind(merged)
    .fetch_one(&world.pool)
    .await
    .unwrap();
    assert_eq!(logged, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_domain_changing_company_after_the_review_makes_it_stale(pool: PgPool) {
    let world = World::new(pool.clone()).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    let merge = targets(stays, &[merged]);
    let before = world.merges.preview(&world.scope(), &merge).await.unwrap();

    // The review shows the same domains either way; only who holds one moved.
    sqlx::query("UPDATE crm_domains SET company_id = $1 WHERE domain = 'merged.example.com'")
        .bind(stays)
        .execute(&pool)
        .await
        .unwrap();
    let after = world.merges.preview(&world.scope(), &merge).await.unwrap();
    assert_eq!(after.identifiers, before.identifiers);
    assert_ne!(after.revision, before.revision);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_merged_value_fills_a_property_the_survivor_left_empty(pool: PgPool) {
    let world = World::new(pool.clone()).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    let tier = world.definition("Tier", false).await;
    world
        .value(&stays.to_string(), "COMPANY", tier, Value::Null)
        .await;
    world
        .value(&merged.to_string(), "COMPANY", tier, text("Gold"))
        .await;

    world
        .merge(&targets(stays, &[merged]), SharingRulesChoice::Keep)
        .await
        .unwrap();

    let kept: Value = sqlx::query_scalar(
        "SELECT values FROM entity_properties
         WHERE entity_type = 'COMPANY' AND entity_id = $1 AND property_definition_id = $2",
    )
    .bind(stays.to_string())
    .bind(tier)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(kept, text("Gold"));
}

/// A team company pipeline holding an entry for each of `companies`.
async fn company_pipeline(
    world: &World,
    name: &str,
    companies: &[Uuid],
) -> crate::domain::pipelines::Pipeline {
    let owner = Viewer {
        user_id: user(OWNER),
        acting_bot: None,
    };
    let pipeline = world
        .workflows
        .create(
            &owner,
            NewPipeline {
                name: name.into(),
                record_type: Some(PipelineRecordType::Company),
                sharing: PipelineSharing::Team,
                stages: Vec::new(),
                fields: Vec::new(),
            },
        )
        .await
        .unwrap()
        .pipeline
        .pipeline;
    for company in companies {
        world
            .workflows
            .add(
                &owner,
                pipeline.id,
                vec![EntryAddition {
                    record: Some(RecordTarget::Id(*company)),
                    set: Vec::new(),
                }],
                false,
            )
            .await
            .unwrap();
    }
    pipeline
}

/// The companies each row's primary cell names, in row order.
async fn named_in(
    pool: &PgPool,
    pipeline: &crate::domain::pipelines::Pipeline,
) -> Vec<Vec<String>> {
    let cells: Vec<Value> = sqlx::query_scalar(
        "SELECT ep.values FROM entity_properties ep JOIN database_rows r ON r.id::text = ep.entity_id
         JOIN database_columns c ON c.table_id = r.table_id AND c.property_definition_id = ep.property_definition_id
         WHERE r.table_id = $1 AND c.id = $2 ORDER BY r.position",
    )
    .bind(pipeline.table_id.into_uuid())
    .bind(pipeline.primary_column_id.into_uuid())
    .fetch_all(pool)
    .await
    .unwrap();
    cells
        .iter()
        .map(|cell| {
            cell["value"]
                .as_array()
                .unwrap()
                .iter()
                .map(|reference| reference["entity_id"].as_str().unwrap().to_string())
                .collect()
        })
        .collect()
}

async fn logged_cells(pool: &PgPool, merge_id: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM crm_merge_changes
         WHERE merge_id = $1 AND owner = 'databases' AND table_name = 'entity_properties'",
    )
    .bind(merge_id)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_trashed_pipeline_restored_later_names_the_company_that_stays(pool: PgPool) {
    let world = World::new(pool.clone()).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    let pipeline = company_pipeline(&world, "Old deals", &[merged]).await;
    sqlx::query("UPDATE crm_pipeline_entities SET trashed_at = now() WHERE id = $1")
        .bind(pipeline.id)
        .execute(&pool)
        .await
        .unwrap();

    let merge = targets(stays, &[merged]);
    let preview = world.merges.preview(&world.scope(), &merge).await.unwrap();
    assert_eq!(preview.moves.pipeline_entries, 0, "the trash isn't shown");
    let outcome = world.merge(&merge, SharingRulesChoice::Keep).await.unwrap();

    sqlx::query("UPDATE crm_pipeline_entities SET trashed_at = NULL WHERE id = $1")
        .bind(pipeline.id)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        named_in(&pool, &pipeline).await,
        vec![vec![stays.to_string()]]
    );
    assert_eq!(logged_cells(&pool, outcome.merge_id).await, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_company_column_of_an_ordinary_database_names_the_company_that_stays(pool: PgPool) {
    let world = World::new(pool.clone()).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    let other = world.company("Other", true, &["other.example.com"]).await;
    // A database with a company column that no pipeline owns: a pipeline's
    // database, kept when its pipeline row goes (with its cleanup trigger off).
    let database = company_pipeline(&world, "Accounts", &[merged, other]).await;
    let mut detach = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL session_replication_role = replica")
        .execute(&mut *detach)
        .await
        .unwrap();
    sqlx::query("DELETE FROM crm_pipeline_entities WHERE id = $1")
        .bind(database.id)
        .execute(&mut *detach)
        .await
        .unwrap();
    detach.commit().await.unwrap();
    assert_eq!(
        named_in(&pool, &database).await,
        vec![vec![merged.to_string()], vec![other.to_string()]]
    );
    let version_before: i64 = world
        .scalar(
            "SELECT version FROM database_tables WHERE id = $1",
            database.table_id.into_uuid(),
        )
        .await;

    let outcome = world
        .merge(&targets(stays, &[merged]), SharingRulesChoice::Keep)
        .await
        .unwrap();

    // Grouped by that column, the row now falls under the company that stays.
    assert_eq!(
        named_in(&pool, &database).await,
        vec![vec![stays.to_string()], vec![other.to_string()]]
    );
    assert_eq!(logged_cells(&pool, outcome.merge_id).await, 1);
    // One journaled write through the database write path, at the version
    // the merge's own write made.
    let version_after: i64 = world
        .scalar(
            "SELECT version FROM database_tables WHERE id = $1",
            database.table_id.into_uuid(),
        )
        .await;
    assert_eq!(version_after, version_before + 1);
    let journaled: i64 = world
        .scalar(
            "SELECT count(*) FROM database_changes WHERE table_id = $1 AND version = (SELECT version FROM database_tables WHERE id = $1)",
            database.table_id.into_uuid(),
        )
        .await;
    assert_eq!(journaled, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_commit_names_each_teammate_whose_rules_it_rewrote_to_tell_them(pool: PgPool) {
    let world = World::new(pool).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    world
        .sharer(&EmailRuleSet {
            schema_version: 1,
            include: vec![EmailInclusionRule::Company { company_id: merged }],
        })
        .await;
    let merge = targets(stays, &[merged]);
    let preview = world.merges.preview(&world.scope(), &merge).await.unwrap();
    let command = MergeCommand {
        targets: merge,
        revision: preview.revision,
        request_key: Uuid::now_v7(),
        sharing_rules: SharingRulesChoice::Keep,
    };

    let committed = world.merges.commit(&world.scope(), &command).await.unwrap();
    assert_eq!(committed.sharing_owners, vec![SHARER.to_string()]);
    let again = world.merges.commit(&world.scope(), &command).await.unwrap();
    assert!(again.replayed);
    assert!(
        again.sharing_owners.is_empty(),
        "a retry tells no one again"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_database_cell_edited_while_the_merge_waits_keeps_the_edit(pool: PgPool) {
    let world = World::new(pool.clone()).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    let other = world.company("Other", true, &["other.example.com"]).await;
    let database = company_pipeline(&world, "Accounts", &[merged]).await;
    let mut detach = pool.begin().await.unwrap();
    sqlx::query("SET LOCAL session_replication_role = replica")
        .execute(&mut *detach)
        .await
        .unwrap();
    sqlx::query("DELETE FROM crm_pipeline_entities WHERE id = $1")
        .bind(database.id)
        .execute(&mut *detach)
        .await
        .unwrap();
    detach.commit().await.unwrap();

    // A writer holds the table's version row, as every batch does until it
    // commits, and points the cell at another company.
    let mut writer = pool.begin().await.unwrap();
    sqlx::query("SELECT version FROM database_tables WHERE id = $1 FOR UPDATE")
        .bind(database.table_id.into_uuid())
        .execute(&mut *writer)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE entity_properties ep SET values = $3
         FROM database_rows r, database_columns c
         WHERE r.id::text = ep.entity_id AND r.table_id = $1
           AND c.table_id = r.table_id AND c.id = $2
           AND c.property_definition_id = ep.property_definition_id",
    )
    .bind(database.table_id.into_uuid())
    .bind(database.primary_column_id.into_uuid())
    .bind(refs(&[other]))
    .execute(&mut *writer)
    .await
    .unwrap();

    let release = async move {
        tokio::time::sleep(std::time::Duration::from_millis(800)).await;
        writer.commit().await.unwrap();
    };
    let merge = targets(stays, &[merged]);
    let (merging, ()) = tokio::join!(world.merge(&merge, SharingRulesChoice::Keep), release);
    merging.unwrap();

    assert_eq!(
        named_in(&pool, &database).await,
        vec![vec![other.to_string()]],
        "the merge read the writer's value, not the one before it"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn another_teams_pipeline_naming_a_merged_company_names_the_one_that_stays(pool: PgPool) {
    let world = World::new(pool.clone()).await;
    let stays = world.company("Stays", true, &["stays.example.com"]).await;
    let merged = world.company("Merged", true, &["merged.example.com"]).await;
    let pipeline = company_pipeline(&world, "Partners", &[merged]).await;
    // A company cell may name another team's company.
    let other_owner = "macro|merge-other@example.com";
    let macro_user = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)",
    )
    .bind(macro_user)
    .bind("merge-other@example.com")
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'merge-other@example.com', $2)"#)
        .bind(other_owner)
        .bind(macro_user)
        .execute(&pool)
        .await
        .unwrap();
    let other_team = Uuid::now_v7();
    sqlx::query("INSERT INTO team (id, name, owner_id) VALUES ($1, 'other', $2)")
        .bind(other_team)
        .bind(other_owner)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE crm_pipeline_entities SET team_id = $2 WHERE id = $1")
        .bind(pipeline.id)
        .bind(other_team)
        .execute(&pool)
        .await
        .unwrap();

    let outcome = world
        .merge(&targets(stays, &[merged]), SharingRulesChoice::Keep)
        .await
        .unwrap();

    assert_eq!(
        named_in(&pool, &pipeline).await,
        vec![vec![stays.to_string()]]
    );
    assert_eq!(logged_cells(&pool, outcome.merge_id).await, 1);
}
