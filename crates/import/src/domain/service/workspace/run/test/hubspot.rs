//! A HubSpot import against the real ledger and an in-memory CRM: plan,
//! approve, write, re-run, resume after a failure, and a teammate's import.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use import_hubspot::domain::{
    Company, CompanyLink, Contact, Deal, DealPipeline, HubspotConnections, HubspotError, Inventory,
    Owner, PipelineKey, Portal, ReadProgress, RecordId, Stage,
};

use super::*;
use crate::domain::models::{HubspotLoss, HubspotLossCount, NotionImportReport};
use crate::domain::ports::ImportError;
use crate::domain::ports::{CrmImportWriter, CrmTeam, DealOutcome, NewCrmContact, NewDealEntry};
use crate::domain::service::WorkspaceImporter;

fn id(value: &str) -> RecordId {
    RecordId::try_from(value.to_owned()).unwrap()
}

fn key(value: &str) -> PipelineKey {
    PipelineKey::try_from(value.to_owned()).unwrap()
}

fn link(company: &str, primary: bool) -> CompanyLink {
    CompanyLink {
        company: id(company),
        primary,
    }
}

fn company(record: &str, name: &str, domain: Option<&str>) -> Company {
    Company {
        id: id(record),
        name: Some(name.into()),
        domain: domain.map(str::to_owned),
        website: None,
        additional_domains: Vec::new(),
        owner: None,
    }
}

fn contact(record: &str, email: Option<&str>, companies: Vec<CompanyLink>) -> Contact {
    Contact {
        id: id(record),
        first_name: Some(format!("Person {record}")),
        last_name: None,
        email: email.map(str::to_owned),
        additional_emails: Vec::new(),
        companies,
        owner: None,
    }
}

fn deal(record: &str, stage: &str, companies: Vec<CompanyLink>) -> Deal {
    Deal {
        id: id(record),
        name: Some(format!("Deal {record}")),
        pipeline: Some(key("default")),
        stage: Some(key(stage)),
        amount: Some(100.0),
        currency: None,
        close_date: Some("2026-03-01T00:00:00Z".into()),
        companies,
        owner: None,
    }
}

/// A small portal with one of each case the write must handle.
fn portal(owner_email: &str) -> Inventory {
    Inventory {
        portal: Portal {
            id: 248109388,
            currency: Some("USD".into()),
            ui_domain: Some("app.hubspot.com".into()),
        },
        owners: vec![
            Owner {
                id: id("1"),
                email: Some(owner_email.to_uppercase()),
                archived: false,
            },
            Owner {
                id: id("2"),
                email: Some("outsider@example.org".into()),
                archived: false,
            },
        ],
        pipelines: vec![DealPipeline {
            id: key("default"),
            label: "Sales Pipeline".into(),
            stages: vec![
                Stage {
                    id: key("open"),
                    label: "Open".into(),
                    closed: false,
                    probability: Some(0.2),
                },
                Stage {
                    id: key("won"),
                    label: "Closed won".into(),
                    closed: true,
                    probability: Some(1.0),
                },
                Stage {
                    id: key("lost"),
                    label: "Closed lost".into(),
                    closed: true,
                    probability: Some(0.0),
                },
            ],
        }],
        companies: vec![
            company("10", "Acme", Some("acme.example")),
            // Same domain: one Macro company.
            company("11", "Acme EU", Some("ACME.example")),
            // A personal provider: created by name only.
            company("12", "Gmail person", Some("gmail.com")),
            company("13", "No domain", None),
        ],
        contacts: vec![
            contact(
                "20",
                Some("ada@acme.example"),
                vec![link("10", true), link("13", false)],
            ),
            contact("21", None, vec![]),
            contact("22", Some("bob@acme.example"), vec![link("10", false)]),
        ],
        deals: vec![
            Deal {
                owner: Some(id("1")),
                ..deal("30", "won", vec![link("13", false), link("10", true)])
            },
            Deal {
                owner: Some(id("2")),
                currency: Some("ISK".into()),
                ..deal("31", "lost", vec![link("12", true)])
            },
            // No company: skipped, counted.
            deal("32", "open", vec![]),
        ],
        custom_properties: Vec::new(),
        warnings: Vec::new(),
    }
}

struct Reader(Inventory);

#[async_trait]
impl HubspotConnections for Reader {
    async fn inventory(
        &self,
        _: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> std::result::Result<Inventory, HubspotError> {
        progress(ReadProgress {
            companies: self.0.companies.len(),
            contacts: self.0.contacts.len(),
            deals: self.0.deals.len(),
        });
        Ok(self.0.clone())
    }
}

/// A team's CRM in memory: natural keys behave like CRM's (one company per
/// domain, one contact per address).
#[derive(Default)]
struct Crm {
    team: Option<CrmTeam>,
    pipelines: Mutex<Vec<(Uuid, String, Vec<String>)>>,
    companies: Mutex<Vec<(Uuid, String, Option<String>)>>,
    contacts: Mutex<Vec<(Uuid, NewCrmContact)>>,
    entries: Mutex<Vec<(Uuid, Uuid, NewDealEntry)>>,
    /// The next contact creation fails, as a crash would.
    fail_next_contact: AtomicBool,
}

#[async_trait]
impl CrmImportWriter for Crm {
    async fn crm_team(&self, _: &MacroUserIdStr<'static>) -> anyhow::Result<Option<CrmTeam>> {
        Ok(self.team.clone())
    }
    fn company_domain(&self, raw: &str) -> Option<String> {
        let domain = raw.trim().to_lowercase();
        (domain.contains('.') && domain != "gmail.com").then_some(domain)
    }
    fn supports_currency(&self, code: &str) -> bool {
        ["USD", "EUR", "GBP", "JPY"].contains(&code)
    }
    async fn company_by_domain(
        &self,
        _: &MacroUserIdStr<'static>,
        domain: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        Ok(self
            .companies
            .lock()
            .unwrap()
            .iter()
            .find(|(_, _, d)| d.as_deref() == Some(domain))
            .map(|(id, _, _)| *id))
    }
    async fn create_company(
        &self,
        _: &MacroUserIdStr<'static>,
        name: &str,
        domain: Option<&str>,
    ) -> anyhow::Result<Uuid> {
        let id = Uuid::now_v7();
        self.companies
            .lock()
            .unwrap()
            .push((id, name.into(), domain.map(str::to_owned)));
        Ok(id)
    }
    async fn contact_by_email(
        &self,
        _: &MacroUserIdStr<'static>,
        email: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        Ok(self
            .contacts
            .lock()
            .unwrap()
            .iter()
            .find(|(_, c)| c.emails.iter().any(|e| e == email))
            .map(|(id, _)| *id))
    }
    async fn create_contact(
        &self,
        _: &MacroUserIdStr<'static>,
        contact: &NewCrmContact,
    ) -> anyhow::Result<Uuid> {
        if self.fail_next_contact.swap(false, Ordering::SeqCst) {
            anyhow::bail!("CRM was unavailable");
        }
        let id = Uuid::now_v7();
        self.contacts.lock().unwrap().push((id, contact.clone()));
        Ok(id)
    }
    async fn create_deal_pipeline(
        &self,
        _: &MacroUserIdStr<'static>,
        name: &str,
        stages: &[String],
    ) -> anyhow::Result<Uuid> {
        let id = Uuid::now_v7();
        self.pipelines
            .lock()
            .unwrap()
            .push((id, name.into(), stages.to_vec()));
        Ok(id)
    }
    async fn deal_links(
        &self,
        _: &MacroUserIdStr<'static>,
        pipeline: Uuid,
    ) -> anyhow::Result<std::collections::HashMap<String, Uuid>> {
        Ok(self
            .entries
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, p, _)| *p == pipeline)
            .map(|(id, _, e)| (e.link.clone(), *id))
            .collect())
    }
    async fn add_deal_entry(
        &self,
        _: &MacroUserIdStr<'static>,
        pipeline: Uuid,
        deal: &NewDealEntry,
    ) -> anyhow::Result<Uuid> {
        let id = Uuid::now_v7();
        self.entries
            .lock()
            .unwrap()
            .push((id, pipeline, deal.clone()));
        Ok(id)
    }
}

fn hubspot_service(
    pool: &PgPool,
    inventory: Inventory,
    crm: Arc<Crm>,
    tracker: TaskTracker,
) -> Service {
    service(pool, Writer::default(), CancellationToken::new(), tracker)
        .with_hubspot(Arc::new(Reader(inventory)), crm)
}

/// A review for `owner`'s HubSpot plan, as the agent presents it.
async fn present(pool: &PgPool, service: &Service, owner: &MacroUserIdStr<'static>) -> Uuid {
    let session = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO agent_session (id, owner_id, bot_id, harness, model, workspace, for_warming) VALUES ($1, $2, '00000000-0000-0000-0000-00000000a2a2', 'macro-inmem', 'test-model', '/workspace', false)"#,
        session,
        owner.as_ref(),
    )
    .execute(pool)
    .await
    .unwrap();
    let review = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO agent_session_review (id, agent_session_id, record) VALUES ($1, $2, '{}'::jsonb)"#,
        review,
        session,
    )
    .execute(pool)
    .await
    .unwrap();
    service
        .attach_workspace_review(
            owner,
            ImportSource::Hubspot,
            review,
            AgentSessionId::new_from_uuid(session),
        )
        .await
        .unwrap();
    review
}

/// Plan, present, approve and finish writing one HubSpot import.
async fn import(
    pool: &PgPool,
    inventory: Inventory,
    crm: Arc<Crm>,
    owner: &MacroUserIdStr<'static>,
) -> NotionImportReport {
    let tracker = TaskTracker::new();
    let service = hubspot_service(pool, inventory, crm, tracker.clone());
    let planned = service
        .prepare_workspace_import(owner, ImportSource::Hubspot, None, Duration::from_secs(60))
        .await
        .unwrap();
    assert_eq!(planned.status, Some(RunStatus::Ready), "{planned:?}");
    let review = present(pool, &service, owner).await;
    match service
        .start_workspace_write(
            owner,
            ImportSource::Hubspot,
            review,
            NotionWriteChoices::default(),
        )
        .await
    {
        Ok(_) => {}
        // A re-run whose plan holds nothing new.
        Err(ImportError::NotReady(_)) => {}
        Err(error) => panic!("{error:?}"),
    }
    tracker.close();
    tracker.wait().await;
    service
        .workspace_import_report(owner, ImportSource::Hubspot)
        .await
        .unwrap()
}

fn crm_for(team: Uuid, members: &[&MacroUserIdStr<'static>]) -> Arc<Crm> {
    Arc::new(Crm {
        team: Some(CrmTeam {
            team_id: team,
            member_emails: members
                .iter()
                .map(|member| member.as_ref().trim_start_matches("macro|").to_owned())
                .collect(),
        }),
        ..Crm::default()
    })
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn writes_a_portal_into_the_crm_and_reruns_add_nothing(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-owner", team).await;
    let crm = crm_for(team, &[&owner]);
    let inventory = portal("hubspot-owner@example.com");

    let report = import(&pool, inventory.clone(), crm.clone(), &owner).await;

    // One pipeline with its stages in order.
    let pipelines = crm.pipelines.lock().unwrap().clone();
    assert_eq!(pipelines.len(), 1);
    assert_eq!(pipelines[0].1, "Sales Pipeline");
    assert_eq!(pipelines[0].2, ["Open", "Closed won", "Closed lost"]);

    // Two HubSpot companies on one domain become one CRM company; a personal
    // provider domain is dropped, never sent to CRM.
    let companies = crm.companies.lock().unwrap().clone();
    let mut written: Vec<_> = companies
        .iter()
        .map(|(_, name, domain)| (name.as_str(), domain.as_deref()))
        .collect();
    written.sort();
    // Whichever of the two Acme rows is written first names the company.
    assert_eq!(written.len(), 3, "{written:?}");
    assert!(written.contains(&("Gmail person", None)));
    assert!(written.contains(&("No domain", None)));
    let (acme, _, _) = companies
        .iter()
        .find(|(_, _, domain)| domain.as_deref() == Some("acme.example"))
        .unwrap()
        .clone();

    // Contacts are filed under their primary company.
    let contacts = crm.contacts.lock().unwrap().clone();
    assert_eq!(contacts.len(), 3);
    let by_email = |email: &str| {
        contacts
            .iter()
            .find(|(_, c)| c.emails.first().map(String::as_str) == Some(email))
            .map(|(_, c)| c.clone())
            .unwrap()
    };
    assert_eq!(by_email("ada@acme.example").company, Some(acme));
    assert_eq!(by_email("ada@acme.example").emails, ["ada@acme.example"]);
    let unnamed: Vec<_> = contacts
        .iter()
        .filter(|(_, c)| c.emails.is_empty())
        .collect();
    assert_eq!(unnamed.len(), 1);
    assert_eq!(unnamed[0].1.company, None);
    assert_eq!(unnamed[0].1.name, "Person 21");

    // Deals: the won one tracks its primary company and its member owner; the
    // ISK one keeps no amount; the one without a company is not written.
    let entries = crm.entries.lock().unwrap().clone();
    assert_eq!(entries.len(), 2);
    let entry = |record: &str| {
        entries
            .iter()
            .find(|(_, _, e)| e.link.ends_with(&format!("/0-3/{record}")))
            .unwrap()
            .clone()
    };
    let (_, pipeline, won) = entry("30");
    assert_eq!(pipeline, pipelines[0].0);
    assert_eq!(won.company, acme);
    assert_eq!(won.stage.as_deref(), Some("Closed won"));
    assert_eq!(won.outcome, DealOutcome::Won);
    assert_eq!(won.amount, Some(100.0));
    assert_eq!(won.currency.as_deref(), Some("USD"));
    assert_eq!(won.close_date.as_deref(), Some("2026-03-01"));
    assert_eq!(won.owner.as_deref(), Some("hubspot-owner@example.com"));
    assert_eq!(
        won.link,
        "https://app.hubspot.com/contacts/248109388/record/0-3/30"
    );
    let (_, _, lost) = entry("31");
    assert_eq!(lost.outcome, DealOutcome::Lost);
    assert_eq!(lost.amount, None);
    assert_eq!(lost.currency, None);
    assert_eq!(lost.owner, None);

    assert_eq!(report.status, Some(RunStatus::Completed), "{report:?}");
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    let hubspot = report.hubspot.unwrap();
    assert_eq!(
        (
            hubspot.pipelines,
            hubspot.companies,
            hubspot.contacts,
            hubspot.deals
        ),
        (1, 4, 3, 3)
    );
    assert_eq!((hubspot.owners, hubspot.owners_matched), (2, 1));
    assert_eq!(
        hubspot.losses,
        [
            HubspotLossCount {
                loss: HubspotLoss::OwnerNotMember,
                count: 1
            },
            HubspotLossCount {
                loss: HubspotLoss::DealWithoutCompany,
                count: 1
            },
            HubspotLossCount {
                loss: HubspotLoss::ExtraCompanyLinks,
                count: 2
            },
            HubspotLossCount {
                loss: HubspotLoss::DomainRejected,
                count: 1
            },
            HubspotLossCount {
                loss: HubspotLoss::UnsupportedCurrency,
                count: 1
            },
        ]
    );

    // A second run of the same portal creates nothing.
    import(&pool, inventory, crm.clone(), &owner).await;
    assert_eq!(crm.pipelines.lock().unwrap().len(), 1);
    assert_eq!(crm.companies.lock().unwrap().len(), 3);
    assert_eq!(crm.contacts.lock().unwrap().len(), 3);
    assert_eq!(crm.entries.lock().unwrap().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_object_is_reported_and_the_next_run_writes_only_it(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-retry", team).await;
    let crm = crm_for(team, &[&owner]);
    crm.fail_next_contact.store(true, Ordering::SeqCst);
    let inventory = portal("hubspot-retry@example.com");

    let report = import(&pool, inventory.clone(), crm.clone(), &owner).await;
    assert_eq!(report.failures.len(), 1, "{report:?}");
    assert_eq!(
        report.failures[0].reason.as_deref(),
        Some("CRM was unavailable")
    );
    assert_eq!(crm.contacts.lock().unwrap().len(), 2);

    let report = import(&pool, inventory, crm.clone(), &owner).await;
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(crm.contacts.lock().unwrap().len(), 3);
    assert_eq!(crm.companies.lock().unwrap().len(), 3);
    assert_eq!(crm.entries.lock().unwrap().len(), 2);
    let emails: HashSet<_> = crm
        .contacts
        .lock()
        .unwrap()
        .iter()
        .flat_map(|(_, c)| c.emails.clone())
        .collect();
    assert_eq!(emails.len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teammate_importing_the_same_portal_links_the_team_copy(pool: PgPool) {
    let team = Uuid::now_v7();
    let first = teammate(&pool, "hubspot-first", team).await;
    let second = teammate(&pool, "hubspot-second", team).await;
    let crm = crm_for(team, &[&first, &second]);
    let inventory = portal("hubspot-first@example.com");

    import(&pool, inventory.clone(), crm.clone(), &first).await;
    let report = import(&pool, inventory, crm.clone(), &second).await;

    assert_eq!(crm.pipelines.lock().unwrap().len(), 1);
    assert_eq!(crm.companies.lock().unwrap().len(), 3);
    assert_eq!(crm.contacts.lock().unwrap().len(), 3);
    assert_eq!(crm.entries.lock().unwrap().len(), 2);
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert!(report.already_in_macro > 0, "{report:?}");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn without_crm_access_nothing_is_planned(pool: PgPool) {
    let owner = teammate(&pool, "hubspot-denied", Uuid::now_v7()).await;
    let service = hubspot_service(
        &pool,
        portal("hubspot-denied@example.com"),
        Arc::new(Crm::default()),
        TaskTracker::new(),
    );
    let result = service
        .prepare_workspace_import(&owner, ImportSource::Hubspot, None, Duration::from_secs(5))
        .await;
    assert!(
        matches!(result, Err(ImportError::CrmAccessRequired)),
        "{result:?}"
    );
    assert!(
        PgImportRepo::new(pool)
            .list(&owner, Some(ImportSource::Hubspot), None)
            .await
            .unwrap()
            .is_empty()
    );
}
