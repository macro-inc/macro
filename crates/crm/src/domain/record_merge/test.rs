use std::collections::HashMap;

use models_properties::service::property_value::PropertyValue;
use uuid::Uuid;

use super::plan::{
    FiledPerson, MergingContact, RecordValue, ValueVisibility, different_companies_block,
    plan_values, request_fingerprint, rewrite_sharing_rules, same_address_block,
};
use super::*;
use crate::domain::email_rules::{
    EMAIL_RULE_SCHEMA_VERSION, EmailInclusionRule, EmailRuleSet, MAX_EMAIL_INCLUSION_RULES,
};

fn id(n: u128) -> Uuid {
    Uuid::from_u128(n)
}

fn targets(survivor: u128, sources: &[u128]) -> MergeTargets {
    MergeTargets::new(
        MergeRecordType::Company,
        id(survivor),
        sources.iter().copied().map(id),
    )
    .unwrap()
}

fn value(record: u128, property: u128, visibility: ValueVisibility, value: f64) -> RecordValue {
    RecordValue {
        record_id: id(record),
        property_id: id(property),
        property_name: format!("Property {property}"),
        visibility,
        value: PropertyValue::Num(value),
    }
}

#[test]
fn targets_refuse_an_empty_merge_a_self_merge_and_too_many_sources() {
    assert!(matches!(
        MergeTargets::new(MergeRecordType::Company, id(1), []),
        Err(MergeError::Invalid(_))
    ));
    assert!(matches!(
        MergeTargets::new(MergeRecordType::Company, id(1), [id(1), id(2)]),
        Err(MergeError::Invalid(_))
    ));
    assert!(matches!(
        MergeTargets::new(MergeRecordType::Company, id(1), (2..=12).map(id)),
        Err(MergeError::Invalid(_))
    ));

    let targets =
        MergeTargets::new(MergeRecordType::Company, id(9), [id(3), id(2), id(3)]).unwrap();
    assert_eq!(targets.sources(), &[id(2), id(3)]);
    assert_eq!(targets.all_sorted(), vec![id(2), id(3), id(9)]);
}

#[test]
fn the_survivors_value_wins_and_only_team_visible_differences_are_shown() {
    let plan = plan_values(
        &targets(1, &[2, 3]),
        &[
            value(1, 10, ValueVisibility::Team, 5.0),
            value(2, 10, ValueVisibility::Team, 7.0),
            value(3, 10, ValueVisibility::Team, 5.0),
            value(2, 11, ValueVisibility::Team, 1.0),
            value(1, 12, ValueVisibility::Private, 3.0),
            value(2, 12, ValueVisibility::Private, 4.0),
        ],
    );

    assert_eq!(plan.moved, vec![(id(2), id(11))]);
    assert_eq!(
        plan.dropped
            .iter()
            .map(|dropped| (dropped.record_id, dropped.property_id, dropped.visibility))
            .collect::<Vec<_>>(),
        vec![
            (id(2), id(10), ValueVisibility::Team),
            (id(2), id(12), ValueVisibility::Private),
        ]
    );
    assert_eq!(plan.conflicts.len(), 1);
    assert_eq!(plan.conflicts[0].property_id, id(10));
    assert_eq!(plan.conflicts[0].kept, PropertyValue::Num(5.0));
    assert_eq!(plan.conflicts[0].dropped.len(), 1);
    assert_eq!(plan.conflicts[0].dropped[0].record_id, id(2));
}

#[test]
fn without_a_survivor_value_the_first_source_by_id_gives_it() {
    let plan = plan_values(
        &targets(1, &[3, 2]),
        &[
            value(3, 10, ValueVisibility::Team, 9.0),
            value(2, 10, ValueVisibility::Team, 8.0),
        ],
    );
    assert_eq!(plan.moved, vec![(id(2), id(10))]);
    assert_eq!(plan.conflicts[0].kept, PropertyValue::Num(8.0));
    assert_eq!(plan.conflicts[0].dropped[0].record_id, id(3));
}

fn rules(include: Vec<EmailInclusionRule>) -> EmailRuleSet {
    EmailRuleSet {
        schema_version: EMAIL_RULE_SCHEMA_VERSION,
        include,
    }
}

fn company(n: u128) -> EmailInclusionRule {
    EmailInclusionRule::Company { company_id: id(n) }
}

fn domain(name: &str) -> EmailInclusionRule {
    EmailInclusionRule::Domain {
        domain: name.into(),
    }
}

#[test]
fn keeping_a_rule_names_the_merged_companys_domains_and_never_the_survivor() {
    let merged = HashMap::from([(id(2), vec!["b.example.com".into(), "a.example.org".into()])]);
    let rewritten = rewrite_sharing_rules(
        &rules(vec![company(2), domain("a.example.org"), company(7)]),
        MergeRecordType::Company,
        &merged,
        SharingRulesChoice::Keep,
    )
    .unwrap()
    .unwrap();

    let mut expected = vec![domain("a.example.org"), domain("b.example.com"), company(7)];
    expected.sort();
    assert_eq!(rewritten.include, expected);
    assert!(!rewritten.include.contains(&company(1)));
}

#[test]
fn stopping_removes_the_rule_and_untouched_rule_sets_are_left_alone() {
    let merged = HashMap::from([(id(2), vec!["b.example.com".into()])]);
    let rewritten = rewrite_sharing_rules(
        &rules(vec![company(2), company(7)]),
        MergeRecordType::Company,
        &merged,
        SharingRulesChoice::Stop,
    )
    .unwrap()
    .unwrap();
    assert_eq!(rewritten.include, vec![company(7)]);

    assert_eq!(
        rewrite_sharing_rules(
            &rules(vec![company(7)]),
            MergeRecordType::Company,
            &merged,
            SharingRulesChoice::Keep,
        )
        .unwrap(),
        None
    );
}

#[test]
fn keeping_a_rule_over_the_limit_is_refused_and_stopping_still_works() {
    let mut include: Vec<_> = (0..MAX_EMAIL_INCLUSION_RULES - 1)
        .map(|n| domain(&format!("d{n}.example.com")))
        .collect();
    include.push(company(2));
    let merged = HashMap::from([(id(2), vec!["x.example.com".into(), "y.example.com".into()])]);

    assert!(matches!(
        rewrite_sharing_rules(
            &rules(include.clone()),
            MergeRecordType::Company,
            &merged,
            SharingRulesChoice::Keep
        ),
        Err(MergeError::SharingRulesTooLarge)
    ));
    let stopped = rewrite_sharing_rules(
        &rules(include),
        MergeRecordType::Company,
        &merged,
        SharingRulesChoice::Stop,
    )
    .unwrap()
    .unwrap();
    assert_eq!(stopped.include.len(), MAX_EMAIL_INCLUSION_RULES - 1);
}

#[test]
fn people_sharing_an_address_across_records_block_the_merge_archived_ones_too() {
    let person = |contact: u128, record: u128, archived: bool, addresses: &[&str]| FiledPerson {
        contact_id: id(contact),
        name: Some(format!("Person {contact}")),
        record_id: id(record),
        archived,
        addresses: addresses
            .iter()
            .map(|address| address.to_string())
            .collect(),
    };

    assert_eq!(
        same_address_block(&[
            person(20, 1, false, &["pat@a.example.com"]),
            person(21, 1, false, &["pat@a.example.com"]),
            person(22, 2, false, &["sam@b.example.com"]),
        ]),
        None,
        "two people under one record were already there; the merge adds none"
    );

    let Some(MergeBlock::SameAddressPeople { people }) = same_address_block(&[
        person(20, 1, false, &["pat@a.example.com", "p@a.example.com"]),
        person(22, 2, true, &["pat@a.example.com"]),
    ]) else {
        panic!("expected a block");
    };
    assert_eq!(
        people
            .iter()
            .map(|person| (person.contact_id, person.archived))
            .collect::<Vec<_>>(),
        vec![(id(20), false), (id(22), true)]
    );
    assert!(
        people
            .iter()
            .all(|person| person.address == "pat@a.example.com")
    );
}

/// A consumer provider; no reserved example domain is one.
const PERSONAL_DOMAIN: &str = "gmail.com";

#[test]
fn people_under_another_company_with_a_work_address_block_a_contact_merge() {
    let contact = |n: u128, company: Option<u128>, addresses: &[&str]| MergingContact {
        contact_id: id(n),
        name: Some(format!("Person {n}")),
        company: company.map(|company| (id(company), format!("Company {company}"))),
        addresses: addresses
            .iter()
            .map(|address| address.to_string())
            .collect(),
    };
    let survivor = contact(1, Some(10), &["pat@a.example.com"]);
    let personal = format!("pat@{PERSONAL_DOMAIN}");

    assert_eq!(
        different_companies_block(
            &survivor,
            &[
                contact(2, Some(10), &["pat.r@a.example.com"]),
                contact(3, None, &["pat@b.example.com"]),
                contact(4, Some(11), &[personal.as_str()]),
            ],
        ),
        None,
        "the same company, no company, or only personal addresses may join it"
    );

    let Some(MergeBlock::DifferentCompanies { people }) = different_companies_block(
        &survivor,
        &[
            contact(5, Some(11), &[personal.as_str(), "pat@b.example.com"]),
            contact(6, Some(12), &[]),
            contact(7, Some(11), &[personal.as_str()]),
        ],
    ) else {
        panic!("expected a block");
    };
    assert_eq!(
        people
            .iter()
            .map(|person| (person.contact_id, person.company_id))
            .collect::<Vec<_>>(),
        vec![(id(5), id(11)), (id(6), id(12))],
        "a work address, or no address to change company with, blocks it"
    );

    let unfiled = contact(1, None, &["pat@a.example.com"]);
    assert!(
        different_companies_block(&unfiled, &[contact(2, Some(10), &["pat@a.example.com"])])
            .is_some(),
        "a person on a company's domain can't leave it for a contact without one"
    );
}

#[test]
fn keeping_a_rule_naming_a_merged_contact_names_its_addresses() {
    let merged: HashMap<Uuid, Vec<String>> = HashMap::from([(
        id(2),
        vec![
            "pat@home.example.com".to_string(),
            "pat@a.example.com".to_string(),
        ],
    )]);
    let before = rules(vec![EmailInclusionRule::Contact { contact_id: id(2) }]);

    let kept = rewrite_sharing_rules(
        &before,
        MergeRecordType::Contact,
        &merged,
        SharingRulesChoice::Keep,
    )
    .unwrap()
    .unwrap();
    assert_eq!(
        kept.include,
        vec![
            EmailInclusionRule::Address {
                address: "pat@a.example.com".into()
            },
            EmailInclusionRule::Address {
                address: "pat@home.example.com".into()
            },
        ]
    );
    let stopped = rewrite_sharing_rules(
        &before,
        MergeRecordType::Contact,
        &merged,
        SharingRulesChoice::Stop,
    )
    .unwrap()
    .unwrap();
    assert!(stopped.include.is_empty());
}

#[test]
fn a_request_key_fingerprints_the_whole_command() {
    let a = targets(1, &[2]);
    let b = targets(1, &[3]);
    assert_eq!(
        request_fingerprint(&a, "r1", SharingRulesChoice::Keep),
        request_fingerprint(&a, "r1", SharingRulesChoice::Keep)
    );
    assert_ne!(
        request_fingerprint(&a, "r1", SharingRulesChoice::Keep),
        request_fingerprint(&a, "r1", SharingRulesChoice::Stop)
    );
    assert_ne!(
        request_fingerprint(&a, "r1", SharingRulesChoice::Keep),
        request_fingerprint(&b, "r1", SharingRulesChoice::Keep)
    );
}

mod service {
    use std::collections::HashSet;
    use std::sync::{Arc, Mutex};

    use bot_id::BotId;
    use entity_access::domain::models::{
        BotReceiptScope, Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole,
        TeamRole,
    };
    use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
    use uuid::Uuid;

    use super::super::service::{
        ChangedEntityProperty, MergeCommitted, MergeEffects, MergeGate, MergeNotices,
        MergePipelineAccess, MergeReferenceAccess, RecordMergeRepository, RecordMergeService,
        RecordMerges,
    };
    use super::super::*;
    use crate::domain::auth::{CrmMemberAccess, CrmTeamReceipt};
    use crate::domain::model::CrmError;
    use models_properties::EntityType as PropertyEntityType;

    const USER: &str = "macro|merger@example.com";

    #[derive(Default)]
    struct Repo {
        calls: Mutex<Vec<&'static str>>,
        replayed: bool,
        preview: Option<MergePreview>,
        sharing_owners: Vec<String>,
    }

    impl CrmMemberAccess for Arc<Repo> {
        async fn member_has_crm_access(&self, _: Uuid, user: &str) -> Result<bool, CrmError> {
            Ok(user == USER)
        }
    }

    fn outcome() -> MergeOutcome {
        MergeOutcome {
            merge_id: Uuid::from_u128(9),
            record_type: MergeRecordType::Company,
            survivor_id: Uuid::from_u128(1),
            merged_ids: vec![Uuid::from_u128(2)],
            committed_at: chrono::DateTime::UNIX_EPOCH,
        }
    }

    impl RecordMergeRepository for Arc<Repo> {
        async fn preview(
            &self,
            _: &MergeScope,
            _: &MergeTargets,
        ) -> Result<MergePreview, MergeError> {
            self.calls.lock().unwrap().push("preview");
            self.preview.clone().ok_or(MergeError::RecordUnavailable)
        }

        async fn commit(
            &self,
            scope: &MergeScope,
            _: &MergeCommand,
        ) -> Result<MergeCommitted, MergeError> {
            assert_eq!(scope.actor.as_ref(), USER);
            self.calls.lock().unwrap().push("commit");
            Ok(MergeCommitted {
                outcome: outcome(),
                replayed: self.replayed,
                changed_properties: vec![ChangedEntityProperty {
                    entity_property_id: Uuid::from_u128(5),
                    entity_id: "task".into(),
                    entity_type: models_properties::EntityType::Document,
                    property_definition_id: Uuid::from_u128(6),
                    value: None,
                    previous_value: None,
                    updated_at: chrono::DateTime::UNIX_EPOCH,
                }],
                sharing_owners: self.sharing_owners.clone(),
            })
        }
    }

    #[derive(Debug)]
    struct Gate(bool);

    #[async_trait::async_trait]
    impl MergeGate for Gate {
        async fn enabled_for(&self, _: MacroUserIdStr<'_>) -> bool {
            self.0
        }
    }

    struct Pipelines(HashSet<Uuid>);

    #[async_trait::async_trait]
    impl MergePipelineAccess for Pipelines {
        async fn readable(
            &self,
            user: &MacroUserIdStr<'static>,
            pipelines: &[Uuid],
        ) -> Result<HashSet<Uuid>, MergeError> {
            assert_eq!(user.as_ref(), USER);
            Ok(pipelines
                .iter()
                .copied()
                .filter(|pipeline| self.0.contains(pipeline))
                .collect())
        }
    }

    #[derive(Default)]
    struct Notices(Mutex<Vec<(Uuid, Uuid, Vec<String>)>>);

    #[async_trait::async_trait]
    impl MergeNotices for Notices {
        async fn sharing_rules_changed(&self, team_id: Uuid, merge_id: Uuid, owners: &[String]) {
            self.0
                .lock()
                .unwrap()
                .push((team_id, merge_id, owners.to_vec()));
        }
    }

    struct Entities(HashSet<String>);

    #[async_trait::async_trait]
    impl MergeReferenceAccess for Entities {
        async fn readable(
            &self,
            user: &MacroUserIdStr<'static>,
            entities: &[(PropertyEntityType, String)],
        ) -> Result<HashSet<(PropertyEntityType, String)>, MergeError> {
            assert_eq!(user.as_ref(), USER);
            Ok(entities
                .iter()
                .filter(|(_, id)| self.0.contains(id))
                .cloned()
                .collect())
        }
    }

    #[derive(Default)]
    struct Effects(Mutex<usize>);

    impl MergeEffects for Effects {
        fn properties_changed(&self, changes: &[ChangedEntityProperty]) {
            *self.0.lock().unwrap() += changes.len();
        }
    }

    fn receipt(role: TeamRole) -> CrmTeamReceipt<MemberTeamRole> {
        CrmTeamReceipt::from_team_receipt(
            EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
                MacroUserIdStr::parse_from_str(USER).unwrap().into_owned(),
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

    fn command() -> MergeCommand {
        MergeCommand {
            targets: MergeTargets::new(
                MergeRecordType::Company,
                Uuid::from_u128(1),
                [Uuid::from_u128(2)],
            )
            .unwrap(),
            revision: "r".into(),
            request_key: Uuid::from_u128(3),
            sharing_rules: SharingRulesChoice::Keep,
        }
    }

    fn service(
        repo: &Arc<Repo>,
        enabled: bool,
        effects: &Arc<Effects>,
    ) -> RecordMergeService<Arc<Repo>> {
        RecordMergeService::new(repo.clone())
            .with_gate(Arc::new(Gate(enabled)))
            .with_effects(effects.clone())
    }

    #[tokio::test]
    async fn only_admins_with_the_flag_reach_the_repository() {
        let repo = Arc::new(Repo::default());
        let effects = Arc::new(Effects::default());

        let off = service(&repo, false, &effects);
        assert!(matches!(
            off.commit(&receipt(TeamRole::Admin), &command()).await,
            Err(MergeError::Unavailable)
        ));
        let ungated = RecordMergeService::new(repo.clone());
        assert!(matches!(
            ungated.commit(&receipt(TeamRole::Owner), &command()).await,
            Err(MergeError::Unavailable)
        ));

        let on = service(&repo, true, &effects);
        assert!(matches!(
            on.commit(&receipt(TeamRole::Member), &command()).await,
            Err(MergeError::PermissionRequired)
        ));
        let team_bot = CrmTeamReceipt::from_team_receipt(
            EntityAccessReceipt::try_new_bot(
                BotId::new_from_uuid(Uuid::from_u128(123)).into_storage_id(),
                BotReceiptScope::Team {
                    team_id: Uuid::from_u128(4),
                },
                Entity {
                    entity_id: Uuid::from_u128(4).to_string(),
                    entity_type: EntityType::Team,
                },
                EntityPermission::TeamRole {
                    role: TeamRole::Admin,
                },
            )
            .unwrap(),
        )
        .unwrap();
        assert!(matches!(
            on.commit(&team_bot, &command()).await,
            Err(MergeError::PermissionRequired)
        ));
        assert!(
            repo.calls.lock().unwrap().is_empty(),
            "refusals never reach storage"
        );

        assert_eq!(
            on.commit(&receipt(TeamRole::Admin), &command())
                .await
                .unwrap(),
            outcome()
        );
        assert_eq!(
            *effects.0.lock().unwrap(),
            1,
            "a commit publishes what it changed"
        );
    }

    #[tokio::test]
    async fn an_exact_retry_publishes_nothing() {
        let repo = Arc::new(Repo {
            replayed: true,
            ..Repo::default()
        });
        let effects = Arc::new(Effects::default());
        service(&repo, true, &effects)
            .commit(&receipt(TeamRole::Owner), &command())
            .await
            .unwrap();
        assert_eq!(*effects.0.lock().unwrap(), 0);
    }

    fn reviewed(open: Uuid, hidden: Uuid) -> MergePreview {
        let shared = |pipeline_id, name: &str| SharedPipeline {
            pipeline_id,
            name: name.into(),
            entries_after: 2,
        };
        MergePreview {
            revision: "r".into(),
            record_type: MergeRecordType::Company,
            survivor: MergedRecord {
                id: Uuid::from_u128(1),
                name: "Kept".into(),
            },
            sources: vec![MergedRecord {
                id: Uuid::from_u128(2),
                name: "Merged".into(),
            }],
            identifiers: vec!["kept.example.com".into()],
            moves: MergeMoves {
                contacts: 0,
                pipeline_entries: 5,
                references: 0,
                discussion_messages: 0,
            },
            shared_pipelines: vec![shared(open, "Deals"), shared(hidden, "Private deals")],
            conflicts: Vec::new(),
            email_sync: MergeEmailSync {
                survivor_syncs: true,
                kept_out: Vec::new(),
            },
            sharing_rules: None,
            blocked: None,
            pipeline_moves: vec![
                PipelineMoves {
                    pipeline_id: open,
                    entries: 2,
                },
                PipelineMoves {
                    pipeline_id: hidden,
                    entries: 3,
                },
            ],
            reference_holders: Vec::new(),
        }
    }

    #[tokio::test]
    async fn a_review_names_and_counts_only_the_pipelines_its_reader_can_open() {
        let [open, hidden] = [Uuid::from_u128(10), Uuid::from_u128(11)];
        let repo = Arc::new(Repo {
            preview: Some(reviewed(open, hidden)),
            ..Repo::default()
        });
        let effects = Arc::new(Effects::default());
        let targets = command().targets;

        let preview = service(&repo, true, &effects)
            .with_pipeline_access(Arc::new(Pipelines(HashSet::from([open]))))
            .preview(&receipt(TeamRole::Admin), &targets)
            .await
            .unwrap();
        assert_eq!(
            preview
                .shared_pipelines
                .iter()
                .map(|shared| shared.pipeline_id)
                .collect::<Vec<_>>(),
            vec![open]
        );
        assert_eq!(preview.moves.pipeline_entries, 2);
        assert_eq!(preview.revision, "r", "the revision still binds them all");

        let unchecked = service(&repo, true, &effects)
            .preview(&receipt(TeamRole::Admin), &targets)
            .await
            .unwrap();
        assert!(unchecked.shared_pipelines.is_empty());
        assert_eq!(unchecked.moves.pipeline_entries, 0);
    }

    #[tokio::test]
    async fn a_review_counts_only_references_its_reader_could_see() {
        let holder = |entity_id: &str, owner: Option<&str>| ReferenceHolder {
            entity_type: PropertyEntityType::Task,
            entity_id: entity_id.into(),
            owner: owner.map(Into::into),
        };
        let mut preview = reviewed(Uuid::from_u128(10), Uuid::from_u128(11));
        preview.moves.references = 5;
        preview.reference_holders = vec![
            holder("shared-task", None),
            holder("private-task", None),
            holder("shared-task", Some("macro|teammate@example.com")),
            holder("shared-task", Some(USER)),
            holder("other-shared-task", None),
        ];
        let repo = Arc::new(Repo {
            preview: Some(preview),
            ..Repo::default()
        });
        let effects = Arc::new(Effects::default());
        let targets = command().targets;

        let counted = service(&repo, true, &effects)
            .with_reference_access(Arc::new(Entities(HashSet::from([
                "shared-task".to_string(),
                "other-shared-task".to_string(),
            ]))))
            .preview(&receipt(TeamRole::Admin), &targets)
            .await
            .unwrap();
        // Not the private task, nor a teammate's personal property.
        assert_eq!(counted.moves.references, 3);
        assert_eq!(counted.revision, "r");

        let unchecked = service(&repo, true, &effects)
            .preview(&receipt(TeamRole::Admin), &targets)
            .await
            .unwrap();
        assert_eq!(unchecked.moves.references, 0);
    }

    #[tokio::test]
    async fn teammates_whose_rules_changed_are_told_once_and_never_on_a_retry() {
        let owners = vec!["macro|sharer@example.com".to_string()];
        let effects = Arc::new(Effects::default());
        for replayed in [false, true] {
            let repo = Arc::new(Repo {
                replayed,
                sharing_owners: owners.clone(),
                ..Repo::default()
            });
            let notices = Arc::new(Notices::default());
            let access = receipt(TeamRole::Admin);
            service(&repo, true, &effects)
                .with_notices(notices.clone())
                .commit(&access, &command())
                .await
                .unwrap();
            let sent = notices.0.lock().unwrap().clone();
            if replayed {
                assert!(sent.is_empty(), "a retry tells no one again");
            } else {
                assert_eq!(
                    sent,
                    vec![(access.team_id(), outcome().merge_id, owners.clone())]
                );
            }
        }
    }
}
