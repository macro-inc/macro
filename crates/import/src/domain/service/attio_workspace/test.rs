use std::collections::HashMap;

use import_attio::domain::{
    Company, CustomAttributes, Deal, Inventory, Member, MemberId, Money, Object, Person, RecordId,
    Stage, StageId, Workspace,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::models::{CrmLoss, CrmLossCount, ImportKind, ImportStatus, NotionDecision};
use crate::domain::ports::{
    CrmImportWriter, CrmMember, CrmTeam, DealOutcome, NewCrmContact, NewDealEntry, PlanRow,
};
use crate::domain::service::crm_workspace::{CrmMeta, CrmObject};

const WORKSPACE: Uuid = Uuid::from_u128(0xa771_0000_0000_0000_0000_0000_0000_0001);

/// CRM's rules for domains and currencies, as the HubSpot plan tests use them.
struct Rules;

#[async_trait::async_trait]
impl CrmImportWriter for Rules {
    async fn crm_team(&self, _: &MacroUserIdStr<'static>) -> anyhow::Result<Option<CrmTeam>> {
        unimplemented!("planning reads the team from its caller")
    }
    fn company_domain(&self, raw: &str) -> Option<String> {
        let domain = raw.trim().to_lowercase();
        (domain.contains('.') && domain != "gmail.com").then_some(domain)
    }
    fn supports_currency(&self, code: &str) -> bool {
        ["USD", "EUR"].contains(&code)
    }
    async fn company_by_domain(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        unimplemented!()
    }
    async fn create_company(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: Option<&str>,
    ) -> anyhow::Result<Uuid> {
        unimplemented!()
    }
    async fn contact_by_email(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        unimplemented!()
    }
    async fn create_contact(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &NewCrmContact,
    ) -> anyhow::Result<Uuid> {
        unimplemented!()
    }
    async fn create_deal_pipeline(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &[String],
    ) -> anyhow::Result<Uuid> {
        unimplemented!()
    }
    async fn deal_entries(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: Uuid,
    ) -> anyhow::Result<HashMap<String, Uuid>> {
        unimplemented!()
    }
    async fn add_deal_entry(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: &NewDealEntry,
    ) -> anyhow::Result<Uuid> {
        unimplemented!()
    }
}

fn record(n: u128) -> RecordId {
    RecordId(Uuid::from_u128(n))
}

fn stage(n: u128) -> StageId {
    StageId(Uuid::from_u128(n))
}

fn member(n: u128) -> MemberId {
    MemberId(Uuid::from_u128(n))
}

fn team() -> CrmTeam {
    CrmTeam {
        team_id: Uuid::nil(),
        members: vec![CrmMember {
            email: "member@example.com".into(),
            user_id: "macro|member@example.com".into(),
        }],
    }
}

fn meta(row: &PlanRow) -> CrmMeta {
    serde_json::from_value(row.metadata.clone()).unwrap()
}

fn rows(inventory: &Inventory) -> Vec<PlanRow> {
    crate::domain::service::crm_workspace::plan::rows(
        &plan::inventory(inventory),
        CrmKinds::ATTIO,
        &team(),
        &Rules,
    )
    .unwrap()
}

/// A synthetic workspace: two companies, two people, three deals.
fn inventory() -> Inventory {
    Inventory {
        workspace: Workspace {
            id: WORKSPACE,
            slug: Some("synthetic-co".into()),
        },
        members: vec![
            Member {
                id: member(1),
                email: Some("Member@Example.com".into()),
            },
            Member {
                id: member(2),
                email: Some("outsider@example.test".into()),
            },
        ],
        stages: vec![
            Stage {
                id: stage(11),
                title: "Lead".into(),
                celebration_enabled: false,
                archived: false,
            },
            Stage {
                id: stage(12),
                title: "Won 🎉".into(),
                celebration_enabled: true,
                archived: false,
            },
            Stage {
                id: stage(13),
                title: "Lost".into(),
                celebration_enabled: false,
                archived: false,
            },
            Stage {
                id: stage(14),
                title: "Old".into(),
                celebration_enabled: false,
                archived: true,
            },
        ],
        companies: vec![
            Company {
                id: record(100),
                name: Some("Globex".into()),
                domains: vec!["Globex.example".into(), "globex.test".into()],
            },
            Company {
                id: record(101),
                name: None,
                domains: vec![],
            },
        ],
        people: vec![
            Person {
                id: record(200),
                full_name: None,
                first_name: Some("Ada".into()),
                last_name: Some("Synthetic".into()),
                emails: vec!["Ada@Globex.example".into(), "ada@else.test".into()],
                company: Some(record(100)),
            },
            Person {
                id: record(201),
                full_name: Some("Grace Synthetic".into()),
                first_name: Some("ignored".into()),
                last_name: None,
                emails: vec![],
                company: None,
            },
        ],
        deals: vec![
            Deal {
                id: record(300),
                name: Some("Renewal".into()),
                stage: Some(stage(12)),
                value: Some(Money {
                    amount: 1200.0,
                    currency: Some("usd".into()),
                }),
                owner: Some(member(1)),
                company: Some(record(100)),
                people: vec![record(200)],
            },
            Deal {
                id: record(301),
                name: None,
                stage: Some(stage(14)),
                value: Some(Money {
                    amount: 5.0,
                    currency: Some("ISK".into()),
                }),
                owner: Some(member(2)),
                company: Some(record(101)),
                people: vec![],
            },
            Deal {
                id: record(302),
                name: Some("Orphan".into()),
                stage: Some(stage(13)),
                value: None,
                owner: None,
                company: None,
                people: vec![],
            },
        ],
        custom_attributes: vec![CustomAttributes {
            object: Object::Companies,
            slugs: vec!["tier".into()],
        }],
        warnings: vec!["Skipped deal record 00000000-0000-0000-0000-00000000012c.".into()],
    }
}

#[test]
fn rows_are_keyed_by_workspace_object_and_record_parents_first() {
    let rows = rows(&inventory());

    let keys: Vec<(ImportKind, &str)> = rows
        .iter()
        .map(|row| (row.kind, row.foreign_id.as_str()))
        .collect();
    let ws = WORKSPACE;
    assert_eq!(
        keys,
        [
            (ImportKind::AttioPipeline, format!("{ws}:pipeline:deals")),
            (
                ImportKind::AttioCompany,
                format!("{ws}:companies:{}", record(100))
            ),
            (
                ImportKind::AttioCompany,
                format!("{ws}:companies:{}", record(101))
            ),
            (
                ImportKind::AttioPerson,
                format!("{ws}:people:{}", record(200))
            ),
            (
                ImportKind::AttioPerson,
                format!("{ws}:people:{}", record(201))
            ),
            (ImportKind::AttioDeal, format!("{ws}:deals:{}", record(300))),
            (ImportKind::AttioDeal, format!("{ws}:deals:{}", record(301))),
            (ImportKind::AttioDeal, format!("{ws}:deals:{}", record(302))),
        ]
        .iter()
        .map(|(kind, key)| (*kind, key.as_str()))
        .collect::<Vec<_>>()
    );
}

#[test]
fn the_deal_stages_become_one_pipeline_without_archived_options() {
    let rows = rows(&inventory());
    let pipeline = meta(&rows[0]);

    assert_eq!(pipeline.title, "Attio deals");
    assert_eq!(
        pipeline.object,
        CrmObject::Pipeline {
            stages: vec!["Lead".into(), "Won 🎉".into(), "Lost".into()]
        }
    );
    let summary = pipeline.summary.unwrap();
    assert_eq!(summary.custom_properties, ["companies.tier"]);
    assert_eq!(summary.owners, 2);
    assert_eq!(summary.owners_matched, 1);
    assert!(
        pipeline
            .warnings
            .iter()
            .any(|w| w.contains("stay in Attio"))
    );
}

#[test]
fn a_company_keeps_its_first_domain_and_counts_the_rest_as_lost() {
    let rows = rows(&inventory());
    let globex = meta(&rows[1]);
    let unnamed = meta(&rows[2]);

    assert_eq!(globex.title, "Globex");
    assert_eq!(
        globex.object,
        CrmObject::Company {
            domain: Some("globex.example".into())
        }
    );
    assert_eq!(globex.losses, [CrmLoss::AdditionalDomains]);
    assert_eq!(
        globex.url.as_deref(),
        Some(format!("https://app.attio.com/synthetic-co/company/{}", record(100)).as_str())
    );
    assert_eq!(unnamed.title, format!("Company {}", record(101)));
    assert!(unnamed.losses.is_empty());
}

#[test]
fn a_person_takes_every_email_and_their_company() {
    let rows = rows(&inventory());
    let ada = meta(&rows[3]);
    let grace = meta(&rows[4]);

    assert_eq!(ada.title, "Ada Synthetic");
    assert_eq!(
        ada.object,
        CrmObject::Contact {
            emails: vec!["ada@globex.example".into(), "ada@else.test".into()],
            company: Some(format!("{WORKSPACE}:companies:{}", record(100))),
        }
    );
    assert_eq!(
        rows[3].parent_foreign_id,
        Some(format!("{WORKSPACE}:companies:{}", record(100)))
    );
    assert_eq!(grace.title, "Grace Synthetic");
}

#[test]
fn deal_outcomes_follow_celebration_and_the_lost_title() {
    let rows = rows(&inventory());
    let CrmObject::Deal(won) = meta(&rows[5]).object else {
        panic!("not a deal");
    };
    let renewal = meta(&rows[5]);

    assert_eq!(won.outcome, DealOutcome::Won);
    assert_eq!(won.stage.as_deref(), Some("Won 🎉"));
    assert_eq!(won.amount, Some(1200.0));
    assert_eq!(won.currency.as_deref(), Some("USD"));
    assert_eq!(won.owner.as_deref(), Some("macro|member@example.com"));
    assert_eq!(renewal.losses, [CrmLoss::DealPeople]);
    assert_eq!(renewal.plan.decision, Some(NotionDecision::Copy));
}

#[test]
fn an_archived_stage_a_foreign_owner_and_an_unsupported_currency_are_losses() {
    let rows = rows(&inventory());
    let deal = meta(&rows[6]);
    let CrmObject::Deal(plan) = &deal.object else {
        panic!("not a deal");
    };

    assert_eq!(deal.title, format!("Deal {}", record(301)));
    assert_eq!(plan.stage, None);
    assert_eq!(plan.outcome, DealOutcome::Open);
    assert_eq!(plan.amount, None);
    assert_eq!(plan.owner, None);
    assert_eq!(
        deal.losses,
        [
            CrmLoss::OwnerNotMember,
            CrmLoss::UnsupportedCurrency,
            CrmLoss::ArchivedStage
        ]
    );
}

#[test]
fn a_deal_with_no_company_is_skipped() {
    let rows = rows(&inventory());
    let orphan = meta(&rows[7]);
    let CrmObject::Deal(plan) = &orphan.object else {
        panic!("not a deal");
    };

    assert_eq!(orphan.plan.decision, Some(NotionDecision::Skip));
    assert_eq!(orphan.losses, [CrmLoss::DealWithoutCompany]);
    assert_eq!(plan.outcome, DealOutcome::Lost);
}

#[test]
fn without_deals_there_is_no_pipeline() {
    let mut inventory = inventory();
    inventory.stages.clear();
    inventory.deals.clear();

    let rows = rows(&inventory);

    assert!(rows.iter().all(|row| row.kind != ImportKind::AttioPipeline));
    assert_eq!(rows[0].kind, ImportKind::AttioCompany);
    assert!(meta(&rows[0]).summary.is_some());
}

#[test]
fn a_workspace_without_a_slug_has_no_record_links() {
    let mut inventory = inventory();
    inventory.workspace.slug = None;

    let rows = rows(&inventory);

    assert!(rows.iter().all(|row| meta(row).url.is_none()));
}

#[test]
fn the_attio_report_counts_only_attio_rows() {
    let review = Uuid::now_v7();
    let rows = rows(&inventory());
    let entities: Vec<crate::domain::models::ImportEntity> = rows
        .iter()
        .map(|row| crate::domain::models::ImportEntity {
            id: Uuid::now_v7(),
            user_id: "macro|member@example.com".into(),
            team_id: None,
            source: crate::domain::models::ImportSource::Attio,
            kind: row.kind,
            foreign_id: row.foreign_id.clone(),
            parent_id: None,
            review_id: Some(review),
            status: ImportStatus::Staged,
            initiator: crate::domain::models::Initiator::Chat,
            metadata: row.metadata.clone(),
            entity_id: None,
            entity_type: None,
            last_error: None,
            waiting_on: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        })
        .collect();

    let attio = report(Some(review), &entities).unwrap();

    assert_eq!(
        (
            attio.pipelines,
            attio.companies,
            attio.contacts,
            attio.deals
        ),
        (1, 2, 2, 3)
    );
    assert!(attio.losses.contains(&CrmLossCount {
        loss: CrmLoss::DealPeople,
        count: 1
    }));
    assert!(crate::domain::service::hubspot_workspace::report(Some(review), &entities).is_none());
}

#[test]
fn a_lost_stage_is_found_whatever_its_case_or_closed_prefix() {
    let mut inventory = inventory();
    let titles = ["lost", "Closed Lost", "Lost 💀", "Lostboys", "Not lost yet"];
    inventory.stages = titles
        .iter()
        .enumerate()
        .map(|(n, title)| Stage {
            id: stage(50 + n as u128),
            title: (*title).into(),
            celebration_enabled: false,
            archived: false,
        })
        .collect();
    inventory.deals = (0..titles.len())
        .map(|n| Deal {
            id: record(400 + n as u128),
            name: Some(format!("Deal {n}")),
            stage: Some(stage(50 + n as u128)),
            value: None,
            owner: None,
            company: Some(record(100)),
            people: vec![],
        })
        .collect();

    let outcomes: Vec<DealOutcome> = rows(&inventory)
        .iter()
        .filter(|row| row.kind == ImportKind::AttioDeal)
        .map(|row| match meta(row).object {
            CrmObject::Deal(plan) => plan.outcome,
            other => panic!("not a deal: {other:?}"),
        })
        .collect();

    assert_eq!(
        outcomes,
        [
            DealOutcome::Lost,
            DealOutcome::Lost,
            DealOutcome::Lost,
            DealOutcome::Open,
            DealOutcome::Open
        ]
    );
}
