use std::collections::HashMap;

use import_salesforce::domain::{
    Account, Contact, Inventory, Opportunity, Org, Owner, RecordId, Stage,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    CrmLoss, ImportEntity, ImportKind, ImportStatus, NotionAlreadyImported, NotionDecision,
};
use crate::domain::ports::{
    CrmImportWriter, CrmMember, CrmTeam, DealOutcome, NewCrmContact, NewDealEntry, PlanRow,
};
use crate::domain::service::crm_workspace::{CrmMeta, CrmObject, DealPlan, PlanSummary};

/// CRM's domain and currency rules; planning reads nothing else.
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

fn id(value: &str) -> RecordId {
    RecordId::try_from(value.to_owned()).unwrap()
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

/// The org's plan rows, through the shared CRM planner.
fn plan_rows(inventory: &Inventory) -> Vec<PlanRow> {
    crate::domain::service::crm_workspace::plan::rows(
        &plan::inventory(inventory),
        CrmKinds::SALESFORCE,
        &team(),
        &Rules,
    )
    .unwrap()
}

fn meta(row: &PlanRow) -> CrmMeta {
    serde_json::from_value(row.metadata.clone()).unwrap()
}

fn stage(api_name: &str, label: &str, closed: bool, won: bool) -> Stage {
    Stage {
        api_name: api_name.into(),
        label: label.into(),
        sort_order: 0,
        closed,
        won,
        probability: None,
    }
}

fn opportunity(record: &str, stage: &str, account: Option<&str>) -> Opportunity {
    Opportunity {
        id: id(record),
        name: None,
        stage: Some(stage.into()),
        amount: Some(1200.0),
        currency: None,
        close_date: Some("2026-03-31".into()),
        account: account.map(id),
        owner: None,
        closed: false,
        won: false,
    }
}

/// One org: three stages (two whose labels differ only by case), two
/// accounts, two contacts and four opportunities.
fn inventory() -> Inventory {
    Inventory {
        org: Org {
            id: id("00D000000000001AAA"),
            instance_url: Some("https://acme.my.salesforce.com".into()),
            currency: Some("EUR".into()),
        },
        owners: vec![
            Owner {
                id: id("005000000000001AAA"),
                email: Some("Member@Example.com".into()),
                active: true,
            },
            Owner {
                id: id("005000000000002AAA"),
                email: Some("outsider@example.org".into()),
                active: true,
            },
        ],
        stages: vec![
            stage("Prospecting", "Prospecting", false, false),
            stage("Closed Won", "Closed Won", true, true),
            stage("closed won", "closed won", true, true),
        ],
        accounts: vec![
            Account {
                id: id("001000000000001AAA"),
                name: Some("Acme".into()),
                website: Some("https://www.Acme.example/about".into()),
                owner: Some(id("005000000000001AAA")),
            },
            Account {
                id: id("001000000000002AAA"),
                name: None,
                website: Some("gmail.com".into()),
                owner: None,
            },
        ],
        contacts: vec![
            Contact {
                id: id("003000000000001AAA"),
                first_name: Some("Ada".into()),
                last_name: Some("Lovelace".into()),
                email: Some("Ada@Acme.example".into()),
                account: Some(id("001000000000001AAA")),
                owner: None,
            },
            Contact {
                id: id("003000000000002AAA"),
                first_name: None,
                last_name: None,
                email: Some("ada@acme.example".into()),
                // Not in the inventory: the contact keeps no company.
                account: Some(id("001000000000009AAA")),
                owner: None,
            },
        ],
        opportunities: vec![
            Opportunity {
                name: Some("Renewal".into()),
                owner: Some(id("005000000000002AAA")),
                closed: true,
                won: true,
                ..opportunity(
                    "006000000000001AAA",
                    "Closed Won",
                    Some("001000000000001AAA"),
                )
            },
            Opportunity {
                currency: Some("isk".into()),
                ..opportunity(
                    "006000000000002AAA",
                    "Retired stage",
                    Some("001000000000001AAA"),
                )
            },
            opportunity("006000000000003AAA", "Prospecting", None),
            Opportunity {
                closed: true,
                ..opportunity(
                    "006000000000004AAA",
                    "closed won",
                    Some("001000000000002AAA"),
                )
            },
        ],
        warnings: vec!["Skipped an unreadable Salesforce record.".into()],
    }
}

fn find<'a>(rows: &'a [PlanRow], key: &str) -> &'a PlanRow {
    rows.iter()
        .find(|row| row.foreign_id == key)
        .unwrap_or_else(|| panic!("no row {key}"))
}

#[test]
fn plans_one_pipeline_of_the_orgs_stages_then_accounts_contacts_and_opportunities() {
    let rows = plan_rows(&inventory());
    let org = "00D000000000001AAA";
    assert_eq!(
        rows.iter()
            .map(|row| (row.kind, row.foreign_id.as_str()))
            .collect::<Vec<_>>(),
        [
            (
                ImportKind::SalesforcePipeline,
                format!("{org}:pipeline:opportunities").as_str()
            ),
            (
                ImportKind::SalesforceCompany,
                format!("{org}:company:001000000000001AAA").as_str()
            ),
            (
                ImportKind::SalesforceCompany,
                format!("{org}:company:001000000000002AAA").as_str()
            ),
            (
                ImportKind::SalesforceContact,
                format!("{org}:contact:003000000000001AAA").as_str()
            ),
            (
                ImportKind::SalesforceContact,
                format!("{org}:contact:003000000000002AAA").as_str()
            ),
            (
                ImportKind::SalesforceDeal,
                format!("{org}:deal:006000000000001AAA").as_str()
            ),
            (
                ImportKind::SalesforceDeal,
                format!("{org}:deal:006000000000002AAA").as_str()
            ),
            (
                ImportKind::SalesforceDeal,
                format!("{org}:deal:006000000000003AAA").as_str()
            ),
            (
                ImportKind::SalesforceDeal,
                format!("{org}:deal:006000000000004AAA").as_str()
            ),
        ]
    );
    // Stage options differ without case, so the second "closed won" gets a
    // suffix.
    let pipeline = meta(&rows[0]);
    assert_eq!(pipeline.title, "Salesforce opportunities");
    assert_eq!(
        pipeline.object,
        CrmObject::Pipeline {
            stages: vec![
                "Prospecting".into(),
                "Closed Won".into(),
                "closed won (2)".into()
            ]
        }
    );
}

#[test]
fn accounts_are_keyed_by_their_websites_domain() {
    let rows = plan_rows(&inventory());
    let acme = meta(find(&rows, "00D000000000001AAA:company:001000000000001AAA"));
    assert_eq!(acme.title, "Acme");
    assert_eq!(
        acme.object,
        CrmObject::Company {
            domain: Some("acme.example".into())
        }
    );
    assert_eq!(acme.losses, [CrmLoss::CompanyOwner]);
    assert_eq!(
        acme.url.as_deref(),
        Some("https://acme.my.salesforce.com/lightning/r/Account/001000000000001AAA/view")
    );
    // A personal provider is no company domain: created by name only.
    let personal = meta(find(&rows, "00D000000000001AAA:company:001000000000002AAA"));
    assert_eq!(personal.title, "Account 001000000000002AAA");
    assert_eq!(personal.object, CrmObject::Company { domain: None });
    assert_eq!(personal.losses, [CrmLoss::DomainRejected]);
}

#[test]
fn contacts_keep_their_account_and_one_address() {
    let rows = plan_rows(&inventory());
    let ada = meta(find(&rows, "00D000000000001AAA:contact:003000000000001AAA"));
    assert_eq!(ada.title, "Ada Lovelace");
    assert_eq!(
        ada.object,
        CrmObject::Contact {
            emails: vec!["ada@acme.example".into()],
            company: Some("00D000000000001AAA:company:001000000000001AAA".into())
        }
    );
    assert!(ada.losses.is_empty());
    // The same address, whatever its case: both become one CRM contact.
    let again = meta(find(&rows, "00D000000000001AAA:contact:003000000000002AAA"));
    assert_eq!(again.title, "ada@acme.example");
    assert_eq!(
        again.object,
        CrmObject::Contact {
            emails: vec!["ada@acme.example".into()],
            company: None
        }
    );
    assert_eq!(again.losses, [CrmLoss::MergedContact]);
}

#[test]
fn opportunities_become_entries_with_their_stage_outcome_amount_and_owner() {
    let rows = plan_rows(&inventory());
    let deal = |id: &str| {
        let meta = meta(find(&rows, &format!("00D000000000001AAA:deal:{id}")));
        let CrmObject::Deal(plan) = meta.object.clone() else {
            panic!("not a deal");
        };
        (meta, *plan)
    };

    let (renewal, plan) = deal("006000000000001AAA");
    assert_eq!(renewal.title, "Renewal");
    assert_eq!(renewal.plan.decision, Some(NotionDecision::Copy));
    assert_eq!(
        plan,
        DealPlan {
            pipeline: "00D000000000001AAA:pipeline:opportunities".into(),
            company: "00D000000000001AAA:company:001000000000001AAA".into(),
            stage: Some("Closed Won".into()),
            outcome: DealOutcome::Won,
            // The org's currency covers an opportunity without one.
            amount: Some(1200.0),
            currency: Some("EUR".into()),
            close_date: Some("2026-03-31".into()),
            owner: None,
        }
    );
    // Its owner is no team member.
    assert_eq!(renewal.losses, [CrmLoss::OwnerNotMember]);

    // A stage that is no longer active, and a currency CRM does not hold.
    let (retired, plan) = deal("006000000000002AAA");
    assert_eq!(plan.stage, None);
    assert_eq!((plan.amount, plan.currency), (None, None));
    assert_eq!(
        retired.losses,
        [CrmLoss::UnsupportedCurrency, CrmLoss::ArchivedStage]
    );

    // No account: skipped, since pipelines track companies.
    let (orphan, _) = deal("006000000000003AAA");
    assert_eq!(orphan.plan.decision, Some(NotionDecision::Skip));
    assert_eq!(orphan.losses, [CrmLoss::DealWithoutCompany]);

    // Closed and not won is lost, in the stage the second "closed won" got.
    let (_, plan) = deal("006000000000004AAA");
    assert_eq!(plan.outcome, DealOutcome::Lost);
    assert_eq!(plan.stage.as_deref(), Some("closed won (2)"));
}

#[test]
fn the_first_row_carries_the_owner_match_and_what_stays_in_salesforce() {
    let rows = plan_rows(&inventory());
    let first = meta(&rows[0]);
    // The account owner is a member; the renewal's owner is not.
    assert_eq!(
        first.summary,
        Some(PlanSummary {
            owners: 2,
            owners_matched: 1,
            custom_properties: Vec::new(),
        })
    );
    assert_eq!(first.warnings.len(), 2);
    assert_eq!(
        first.warnings[0],
        "Skipped an unreadable Salesforce record."
    );
    assert!(first.warnings[1].ends_with("stay in Salesforce."));
}

#[test]
fn without_an_instance_records_have_no_link() {
    let mut inventory = inventory();
    inventory.org.instance_url = None;
    let rows = plan_rows(&inventory);
    assert!(rows.iter().all(|row| meta(row).url.is_none()));
}

#[test]
fn accounts_sharing_a_domain_whatever_its_case_are_merged() {
    let mut inventory = inventory();
    inventory.accounts.push(Account {
        id: id("001000000000003AAA"),
        name: Some("Acme EU".into()),
        website: Some("ACME.example".into()),
        owner: None,
    });
    let rows = plan_rows(&inventory);
    let eu = meta(find(&rows, "00D000000000001AAA:company:001000000000003AAA"));
    assert_eq!(eu.losses, [CrmLoss::MergedCompany]);
}

fn ledger_row(
    key: &str,
    kind: ImportKind,
    status: ImportStatus,
    review: Uuid,
    meta: CrmMeta,
) -> ImportEntity {
    ImportEntity {
        id: Uuid::now_v7(),
        user_id: "macro|owner@example.com".into(),
        team_id: None,
        source: crate::domain::models::ImportSource::Salesforce,
        kind,
        foreign_id: key.into(),
        parent_id: None,
        review_id: Some(review),
        status,
        initiator: crate::domain::models::Initiator::Chat,
        metadata: serde_json::to_value(meta).unwrap(),
        entity_id: None,
        entity_type: None,
        last_error: None,
        waiting_on: None,
        created_at: chrono::Utc::now(),
        updated_at: chrono::Utc::now(),
    }
}

#[test]
fn the_report_counts_this_reviews_records_losses_and_copies() {
    let rows = plan_rows(&inventory());
    let review = Uuid::now_v7();
    let mut ledger: Vec<ImportEntity> = rows
        .iter()
        .map(|row| {
            ledger_row(
                &row.foreign_id,
                row.kind,
                ImportStatus::Staged,
                review,
                meta(row),
            )
        })
        .collect();
    // The owner left Acme out, so Ada is written without a company.
    ledger[1].status = ImportStatus::Discarded;
    // A teammate already imported the second account.
    let mut copied = meta(&rows[2]);
    copied.plan.already_imported = Some(NotionAlreadyImported {
        by: "macro|teammate@example.com".into(),
        entity_id: Uuid::now_v7().to_string(),
        entity_type: "crm_company".into(),
    });
    ledger[2].metadata = serde_json::to_value(copied).unwrap();

    let report = report(Some(review), &ledger).unwrap();
    assert_eq!(
        (
            report.pipelines,
            report.companies,
            report.contacts,
            report.deals
        ),
        (1, 2, 2, 4)
    );
    assert_eq!((report.owners, report.owners_matched), (2, 1));
    assert_eq!(report.already_imported, 1);
    let count = |loss| {
        report
            .losses
            .iter()
            .find(|counted| counted.loss == loss)
            .map(|counted| counted.count)
    };
    assert_eq!(count(CrmLoss::ContactWithoutCompany), Some(1));
    assert_eq!(count(CrmLoss::MergedContact), Some(1));
    assert_eq!(count(CrmLoss::DealWithoutCompany), Some(1));
    // Another review's left-out account does not count against this one.
    let other = report_for_other_review(&ledger);
    assert_eq!(
        other
            .losses
            .iter()
            .find(|counted| counted.loss == CrmLoss::ContactWithoutCompany),
        None
    );
}

fn report_for_other_review(ledger: &[ImportEntity]) -> CrmReport {
    report(Some(Uuid::now_v7()), ledger).unwrap()
}

#[test]
fn no_salesforce_rows_no_section() {
    assert_eq!(report(None, &[]), None);
}
