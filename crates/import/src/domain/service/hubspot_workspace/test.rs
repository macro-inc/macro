use super::*;
use crate::domain::models::NotionDecision;
use crate::domain::ports::{CrmTeam, PlanRow};
use import_hubspot::domain::{
    Company, CompanyLink, CustomProperties, Deal, DealPipeline, Inventory, ObjectType, Owner,
    PipelineKey, Portal, RecordId, Stage,
};

/// CRM's rules for domains and currencies; `keep_case` returns a domain as
/// given, to prove the plan normalizes it itself.
#[derive(Default)]
struct Rules {
    keep_case: bool,
}

#[async_trait::async_trait]
impl CrmImportWriter for Rules {
    async fn crm_team(&self, _: &MacroUserIdStr<'static>) -> anyhow::Result<Option<CrmTeam>> {
        unimplemented!("planning reads the team from its caller")
    }
    fn company_domain(&self, raw: &str) -> Option<String> {
        let domain = if self.keep_case {
            raw.to_owned()
        } else {
            raw.trim().to_lowercase()
        };
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

fn key(value: &str) -> PipelineKey {
    PipelineKey::try_from(value.to_owned()).unwrap()
}

fn team() -> CrmTeam {
    CrmTeam {
        team_id: Uuid::nil(),
        members: vec![crate::domain::ports::CrmMember {
            email: "member@example.com".into(),
            user_id: "macro|member@example.com".into(),
        }],
    }
}

fn meta(row: &PlanRow) -> HubspotMeta {
    serde_json::from_value(row.metadata.clone()).unwrap()
}

fn inventory() -> Inventory {
    Inventory {
        portal: Portal {
            id: 7,
            currency: Some("EUR".into()),
            ui_domain: Some("app-eu1.hubspot.com".into()),
        },
        owners: vec![Owner {
            id: id("1"),
            email: Some("Member@Example.com".into()),
            archived: false,
        }],
        pipelines: vec![DealPipeline {
            id: key("default"),
            label: "Sales".into(),
            stages: vec![
                Stage {
                    id: key("a"),
                    label: "Review".into(),
                    closed: false,
                    probability: None,
                },
                Stage {
                    id: key("b"),
                    label: "Review".into(),
                    closed: true,
                    probability: Some(0.5),
                },
            ],
        }],
        companies: vec![Company {
            id: id("10"),
            name: None,
            domain: None,
            website: Some("https://www.globex.example:8443/about?x=1".into()),
            additional_domains: vec!["globex.io".into()],
            owner: Some(id("1")),
        }],
        contacts: vec![],
        deals: vec![Deal {
            id: id("30"),
            name: None,
            pipeline: Some(key("default")),
            stage: Some(key("b")),
            amount: Some(5.0),
            currency: Some("isk".into()),
            close_date: Some("not a date".into()),
            companies: vec![CompanyLink {
                company: id("10"),
                primary: false,
            }],
            owner: Some(id("1")),
        }],
        custom_properties: vec![CustomProperties {
            object: ObjectType::Deal,
            names: vec!["renewal_date".into()],
        }],
        warnings: vec!["Skipped an unreadable HubSpot company.".into()],
    }
}

#[test]
fn plans_keys_titles_domains_and_stage_labels() {
    let rows = plan::rows(&inventory(), &team(), &Rules::default()).unwrap();
    assert_eq!(
        rows.iter()
            .map(|row| row.foreign_id.as_str())
            .collect::<Vec<_>>(),
        ["7:pipeline:default", "7:company:10", "7:deal:30"]
    );
    // Repeated stage labels stay distinct options.
    assert_eq!(
        meta(&rows[0]).object,
        HubspotObject::Pipeline {
            stages: vec!["Review".into(), "Review (2)".into()]
        }
    );
    // A website stands in for a missing domain, and names a nameless company.
    let company = meta(&rows[1]);
    assert_eq!(company.title, "globex.example");
    assert_eq!(
        company.object,
        HubspotObject::Company {
            domain: Some("globex.example".into())
        }
    );
    assert_eq!(
        company.losses,
        [HubspotLoss::AdditionalDomains, HubspotLoss::CompanyOwner]
    );
    assert_eq!(
        company.url.as_deref(),
        Some("https://app-eu1.hubspot.com/contacts/7/record/0-2/10")
    );
}

#[test]
fn a_currency_macro_does_not_support_drops_the_amount() {
    let rows = plan::rows(&inventory(), &team(), &Rules::default()).unwrap();
    let deal = meta(&rows[2]);
    assert_eq!(deal.title, "Deal 30");
    assert_eq!(deal.plan.decision, Some(NotionDecision::Copy));
    assert_eq!(deal.losses, [HubspotLoss::UnsupportedCurrency]);
    let HubspotObject::Deal(plan) = deal.object else {
        panic!("deal payload lost")
    };
    assert_eq!(plan.amount, None);
    assert_eq!(plan.currency, None);
    // A closed stage short of certain is lost; a bad date is dropped.
    assert_eq!(plan.outcome, DealOutcome::Lost);
    assert_eq!(plan.stage.as_deref(), Some("Review (2)"));
    assert_eq!(plan.close_date, None);
    assert_eq!(plan.owner.as_deref(), Some("macro|member@example.com"));
}

#[test]
fn the_portal_currency_covers_deals_without_one() {
    let mut inventory = inventory();
    inventory.deals[0].currency = None;
    let rows = plan::rows(&inventory, &team(), &Rules::default()).unwrap();
    let HubspotObject::Deal(plan) = meta(&rows[2]).object else {
        panic!("deal payload lost")
    };
    assert_eq!(
        (plan.amount, plan.currency.as_deref()),
        (Some(5.0), Some("EUR"))
    );
}

#[test]
fn a_deal_in_an_unknown_pipeline_is_skipped_and_counted() {
    let mut inventory = inventory();
    inventory.deals[0].pipeline = Some(key("retired"));
    let rows = plan::rows(&inventory, &team(), &Rules::default()).unwrap();
    let deal = meta(&rows[2]);
    assert_eq!(deal.plan.decision, Some(NotionDecision::Skip));
    assert!(deal.losses.contains(&HubspotLoss::DealWithoutPipeline));
    assert!(rows[2].parent_foreign_id.is_none());
}

#[test]
fn the_first_row_carries_the_summary_and_warnings() {
    let rows = plan::rows(&inventory(), &team(), &Rules::default()).unwrap();
    let first = meta(&rows[0]);
    assert_eq!(
        first.summary,
        Some(PlanSummary {
            owners: 1,
            owners_matched: 1,
            custom_properties: vec!["deals.renewal_date".into()],
        })
    );
    assert_eq!(first.warnings.len(), 2);
    assert!(rows[1..].iter().all(|row| meta(row).summary.is_none()));
    for row in &rows {
        let plan = meta(row).plan;
        assert!(plan.shared && !plan.shareable);
    }
}

#[test]
fn merges_are_counted_whatever_the_case() {
    let mut inventory = inventory();
    let company = inventory.companies[0].clone();
    inventory.companies = vec![
        Company {
            id: id("1"),
            domain: Some("Acme.Example".into()),
            ..company.clone()
        },
        Company {
            id: id("2"),
            domain: Some(" acme.example. ".into()),
            ..company
        },
    ];
    inventory.deals.clear();
    let rows = plan::rows(&inventory, &team(), &Rules { keep_case: true }).unwrap();
    let merged: Vec<_> = rows
        .iter()
        .filter(|row| meta(row).losses.contains(&HubspotLoss::MergedCompany))
        .map(|row| row.foreign_id.as_str())
        .collect();
    assert_eq!(merged, ["7:company:2"]);
}

fn ledger_row(
    key: &str,
    kind: ImportKind,
    status: ImportStatus,
    review: Uuid,
    meta: HubspotMeta,
) -> ImportEntity {
    ImportEntity {
        id: Uuid::now_v7(),
        user_id: "macro|owner@example.com".into(),
        team_id: None,
        source: crate::domain::models::ImportSource::Hubspot,
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
fn only_this_reviews_left_out_companies_count_against_contacts() {
    let rows = plan::rows(&inventory(), &team(), &Rules::default()).unwrap();
    let company = meta(&rows[1]);
    let contact = HubspotMeta {
        title: "Ada".into(),
        object: HubspotObject::Contact {
            emails: vec![],
            company: Some("7:company:10".into()),
        },
        losses: vec![],
        summary: None,
        warnings: vec![],
        ..company.clone()
    };
    let (current, older) = (Uuid::now_v7(), Uuid::now_v7());
    let contact_row = ledger_row(
        "7:contact:20",
        ImportKind::HubspotContact,
        ImportStatus::Staged,
        current,
        contact,
    );
    let without = |review| {
        let left_out = ledger_row(
            "7:company:10",
            ImportKind::HubspotCompany,
            ImportStatus::Discarded,
            review,
            company.clone(),
        );
        report(Some(current), [&left_out, &contact_row])
            .unwrap()
            .losses
            .iter()
            .find(|loss| loss.loss == HubspotLoss::ContactWithoutCompany)
            .map(|loss| loss.count)
    };
    assert_eq!(without(current), Some(1));
    assert_eq!(without(older), None);
}
