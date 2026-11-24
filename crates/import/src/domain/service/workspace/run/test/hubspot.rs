//! A HubSpot import against the real ledger and an in-memory CRM: plan,
//! approve, write, re-run, resume after a failure, and a teammate's import.

use std::collections::HashSet;
use std::time::Duration;

use async_trait::async_trait;
use import_hubspot::domain::{
    Company, CompanyLink, Contact, Deal, DealPipeline, HubspotConnections, HubspotError, Inventory,
    Owner, PipelineKey, Portal, ReadProgress, RecordId, Stage,
};

use super::*;
use crate::domain::models::{HubspotLoss, HubspotLossCount, NotionImportReport};
use crate::domain::models::{WrittenKind, WrittenObject};
use crate::domain::ports::ImportError;
use crate::domain::ports::{
    CrmImportWriter, CrmMember, CrmTeam, DealOutcome, NewCrmContact, NewDealEntry,
};
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
            // Same primary address as 20: one CRM contact.
            contact("23", Some("ADA@acme.example"), vec![]),
            // Its further address is never used to match.
            Contact {
                additional_emails: vec!["carol.home@example.net".into()],
                ..contact("24", Some("carol@acme.example"), vec![link("10", true)])
            },
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
    async fn connected(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<bool, HubspotError> {
        Ok(true)
    }
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

/// A user who has not connected HubSpot.
struct Disconnected;

#[async_trait]
impl HubspotConnections for Disconnected {
    async fn connected(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<bool, HubspotError> {
        Ok(false)
    }
    async fn inventory(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> std::result::Result<Inventory, HubspotError> {
        Err(HubspotError::NotConnected)
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
    /// Contacts with these names fail to be created, once each.
    failing_contacts: Mutex<HashSet<String>>,
    /// Companies with these names fail to be created.
    failing_companies: Mutex<HashSet<String>>,
    /// Records with these names are created, then the call fails, as a crash
    /// between creating and recording would; once each.
    crash_after_create: Mutex<HashSet<String>>,
    /// Every address contacts were looked up by.
    email_lookups: Mutex<Vec<String>>,
    /// Reads of a company's pipeline entries.
    entry_reads: std::sync::atomic::AtomicUsize,
    /// Creating the company with this name signals shutdown and fails, as a
    /// call cut short by the process stopping would.
    stop_on_create: Mutex<Option<(String, CancellationToken)>>,
    /// Creating the company with this name first settles this ledger row
    /// elsewhere, so the write finds it no longer importing.
    settle_on_create: Mutex<Option<(String, PgPool, String)>>,
    /// When the first pipeline is created, this ledger row is linked to this
    /// company, as a teammate's write finishing meanwhile would.
    on_pipeline: Mutex<Option<(PgPool, Uuid, Uuid)>>,
}

impl Crm {
    fn crash(&self, name: &str) -> anyhow::Result<()> {
        if self.crash_after_create.lock().unwrap().remove(name) {
            anyhow::bail!("the process stopped");
        }
        Ok(())
    }
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
        if self.failing_companies.lock().unwrap().contains(name) {
            anyhow::bail!("CRM refused the company");
        }
        let stop = self
            .stop_on_create
            .lock()
            .unwrap()
            .take_if(|(stop, _)| stop == name);
        if let Some((_, shutdown)) = stop {
            shutdown.cancel();
            anyhow::bail!("the process is stopping");
        }
        let settle = self
            .settle_on_create
            .lock()
            .unwrap()
            .take_if(|(settle, ..)| settle == name);
        if let Some((_, pool, key)) = settle {
            sqlx::query!(
                "UPDATE import_entity SET status = 'discarded' WHERE foreign_id = $1",
                key
            )
            .execute(&pool)
            .await?;
        }
        let id = Uuid::now_v7();
        self.companies
            .lock()
            .unwrap()
            .push((id, name.into(), domain.map(str::to_owned)));
        self.crash(name)?;
        Ok(id)
    }
    async fn contact_by_email(
        &self,
        _: &MacroUserIdStr<'static>,
        email: &str,
    ) -> anyhow::Result<Option<Uuid>> {
        self.email_lookups.lock().unwrap().push(email.to_owned());
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
        if self.failing_contacts.lock().unwrap().remove(&contact.name) {
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
        let hook = self.on_pipeline.lock().unwrap().take();
        if let Some((pool, row, company)) = hook {
            sqlx::query!(
                "UPDATE import_entity SET status = 'imported', entity_id = $1, entity_type = 'crm_company', waiting_on = NULL WHERE id = $2",
                company.to_string(),
                row
            )
            .execute(&pool)
            .await?;
        }
        let id = Uuid::now_v7();
        self.pipelines
            .lock()
            .unwrap()
            .push((id, name.into(), stages.to_vec()));
        Ok(id)
    }
    async fn deal_entries(
        &self,
        _: &MacroUserIdStr<'static>,
        pipeline: Uuid,
        company: Uuid,
    ) -> anyhow::Result<std::collections::HashMap<String, Uuid>> {
        self.entry_reads
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(self
            .entries
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, p, e)| *p == pipeline && e.company == company)
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
        self.crash(&deal.name)?;
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

/// A planned and presented HubSpot import, not yet approved.
struct Planned {
    service: Service,
    tracker: TaskTracker,
    review: Uuid,
}

async fn plan(
    pool: &PgPool,
    inventory: Inventory,
    crm: Arc<Crm>,
    owner: &MacroUserIdStr<'static>,
) -> Planned {
    let tracker = TaskTracker::new();
    let service = hubspot_service(pool, inventory, crm, tracker.clone());
    let planned = service
        .prepare_workspace_import(owner, ImportSource::Hubspot, None, Duration::from_secs(60))
        .await
        .unwrap();
    assert_eq!(planned.status, Some(RunStatus::Ready), "{planned:?}");
    let review = present(pool, &service, owner).await;
    Planned {
        service,
        tracker,
        review,
    }
}

/// Approve with `choices` and wait for the write to end.
async fn finish(
    planned: Planned,
    owner: &MacroUserIdStr<'static>,
    choices: NotionWriteChoices,
) -> NotionImportReport {
    let Planned {
        service,
        tracker,
        review,
    } = planned;
    match service
        .start_workspace_write(owner, ImportSource::Hubspot, review, choices)
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

/// Plan, present, approve and finish writing one HubSpot import.
async fn import(
    pool: &PgPool,
    inventory: Inventory,
    crm: Arc<Crm>,
    owner: &MacroUserIdStr<'static>,
) -> NotionImportReport {
    let planned = plan(pool, inventory, crm, owner).await;
    finish(planned, owner, NotionWriteChoices::default()).await
}

/// The ledger row planned for a HubSpot object.
async fn row_id(pool: &PgPool, owner: &MacroUserIdStr<'static>, key: &str) -> Uuid {
    PgImportRepo::new(pool.clone())
        .list(owner, Some(ImportSource::Hubspot), None)
        .await
        .unwrap()
        .into_iter()
        .find(|row| row.foreign_id == format!("248109388:{key}"))
        .unwrap()
        .id
}

fn crm_for(team: Uuid, members: &[&MacroUserIdStr<'static>]) -> Arc<Crm> {
    Arc::new(Crm {
        team: Some(CrmTeam {
            team_id: team,
            members: members
                .iter()
                .map(|member| CrmMember {
                    email: member.as_ref().trim_start_matches("macro|").to_owned(),
                    user_id: member.as_ref().to_owned(),
                })
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
    assert_eq!(contacts.len(), 4);
    // Contacts are matched by their primary address only.
    let lookups = crm.email_lookups.lock().unwrap().clone();
    assert!(
        !lookups
            .iter()
            .any(|email| email == "carol.home@example.net"),
        "{lookups:?}"
    );
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
    // The owner is stored as the member's Macro user id.
    assert_eq!(won.owner.as_deref(), Some(owner.as_ref()));
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
        (1, 4, 5, 3)
    );
    // Company 11 shares Acme's domain and contact 23 shares Ada's address:
    // both link to the record their twin created.
    assert_eq!((hubspot.created, hubspot.linked), (10, 2));
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
            HubspotLossCount {
                loss: HubspotLoss::MergedCompany,
                count: 1
            },
            HubspotLossCount {
                loss: HubspotLoss::MergedContact,
                count: 1
            },
        ]
    );

    // A second run of the same portal creates nothing.
    import(&pool, inventory, crm.clone(), &owner).await;
    assert_eq!(crm.pipelines.lock().unwrap().len(), 1);
    assert_eq!(crm.companies.lock().unwrap().len(), 3);
    assert_eq!(crm.contacts.lock().unwrap().len(), 4);
    assert_eq!(crm.entries.lock().unwrap().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_object_is_reported_and_the_next_run_writes_only_it(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-retry", team).await;
    let crm = crm_for(team, &[&owner]);
    crm.failing_contacts
        .lock()
        .unwrap()
        .insert("Person 22".into());
    let inventory = portal("hubspot-retry@example.com");

    let report = import(&pool, inventory.clone(), crm.clone(), &owner).await;
    assert_eq!(report.failures.len(), 1, "{report:?}");
    assert_eq!(
        report.failures[0].reason.as_deref(),
        Some("CRM was unavailable")
    );
    assert_eq!(crm.contacts.lock().unwrap().len(), 3);

    let report = import(&pool, inventory, crm.clone(), &owner).await;
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(crm.contacts.lock().unwrap().len(), 4);
    assert_eq!(crm.companies.lock().unwrap().len(), 3);
    assert_eq!(crm.entries.lock().unwrap().len(), 2);
    let emails: HashSet<_> = crm
        .contacts
        .lock()
        .unwrap()
        .iter()
        .flat_map(|(_, c)| c.emails.clone())
        .collect();
    assert_eq!(emails.len(), 4);
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
    assert_eq!(crm.contacts.lock().unwrap().len(), 4);
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn without_a_connection_the_user_is_asked_to_connect_and_no_import_fails(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-unconnected", team).await;
    let crm = crm_for(team, &[&owner]);
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    )
    .with_hubspot(Arc::new(Disconnected), crm);

    let result = service
        .prepare_workspace_import(&owner, ImportSource::Hubspot, None, Duration::from_secs(5))
        .await;

    assert!(
        matches!(
            result,
            Err(ImportError::Hubspot(HubspotError::NotConnected))
        ),
        "{result:?}"
    );
    // No run was started, so nothing shows a failed import.
    let report = service
        .workspace_import_report(&owner, ImportSource::Hubspot)
        .await
        .unwrap();
    assert_eq!(report.status, None, "{report:?}");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_contact_whose_company_failed_waits_for_it_instead_of_losing_it(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-orphan", team).await;
    let crm = crm_for(team, &[&owner]);
    crm.failing_companies
        .lock()
        .unwrap()
        .extend(["Acme".to_owned(), "Acme EU".to_owned()]);
    let mut inventory = portal("hubspot-orphan@example.com");
    // No twin address: Ada's record must be her own.
    inventory
        .contacts
        .retain(|contact| contact.id.as_str() != "23");

    let report = import(&pool, inventory.clone(), crm.clone(), &owner).await;
    let failed: HashSet<_> = report
        .failures
        .iter()
        .map(|failure| failure.title.as_str())
        .collect();
    for name in ["Person 20", "Person 22", "Person 24", "Deal 30"] {
        assert!(failed.contains(name), "{name} in {failed:?}");
    }
    // Nothing filed under Acme was created without it.
    assert!(
        crm.contacts
            .lock()
            .unwrap()
            .iter()
            .all(|(_, contact)| contact.name == "Person 21"),
        "{:?}",
        crm.contacts.lock().unwrap()
    );

    crm.failing_companies.lock().unwrap().clear();
    let report = import(&pool, inventory, crm.clone(), &owner).await;
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    let acme = crm
        .companies
        .lock()
        .unwrap()
        .iter()
        .find(|(_, _, domain)| domain.as_deref() == Some("acme.example"))
        .unwrap()
        .0;
    let contacts = crm.contacts.lock().unwrap().clone();
    assert_eq!(contacts.len(), 4);
    for (_, contact) in contacts.iter().filter(|(_, c)| c.name != "Person 21") {
        assert_eq!(contact.company, Some(acme), "{contact:?}");
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn contacts_of_a_left_out_company_are_counted(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-excluded", team).await;
    let crm = crm_for(team, &[&owner]);
    let planned = plan(
        &pool,
        portal("hubspot-excluded@example.com"),
        crm.clone(),
        &owner,
    )
    .await;
    let choices = NotionWriteChoices {
        excluded: vec![
            row_id(&pool, &owner, "company:10").await,
            row_id(&pool, &owner, "company:11").await,
        ],
        ..NotionWriteChoices::default()
    };
    let report = finish(planned, &owner, choices).await;

    // Ada, Bob and Carol are created without a company, and counted.
    let contacts = crm.contacts.lock().unwrap().clone();
    assert_eq!(contacts.len(), 4, "{contacts:?}");
    assert!(
        contacts
            .iter()
            .all(|(_, contact)| contact.company.is_none())
    );
    let losses = report.hubspot.unwrap().losses;
    assert!(
        losses.contains(&HubspotLossCount {
            loss: HubspotLoss::ContactWithoutCompany,
            count: 3
        }),
        "{losses:?}"
    );
    // The deal that tracks Acme cannot be written and says why.
    assert!(
        report
            .failures
            .iter()
            .any(|failure| failure.title == "Deal 30"
                && failure
                    .reason
                    .as_deref()
                    .is_some_and(|r| r.contains("left out"))),
        "{:?}",
        report.failures
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn records_made_before_a_stop_are_found_again_not_duplicated(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-crash", team).await;
    let crm = crm_for(team, &[&owner]);
    // The process stops after CRM made these, before the ledger recorded them.
    crm.crash_after_create
        .lock()
        .unwrap()
        .extend(["Acme".to_owned(), "Deal 31".to_owned()]);
    let inventory = portal("hubspot-crash@example.com");

    let report = import(&pool, inventory.clone(), crm.clone(), &owner).await;
    assert!(!report.failures.is_empty());
    let report = import(&pool, inventory, crm.clone(), &owner).await;
    assert!(report.failures.is_empty(), "{:?}", report.failures);

    assert_eq!(crm.pipelines.lock().unwrap().len(), 1);
    assert_eq!(crm.companies.lock().unwrap().len(), 3);
    assert_eq!(crm.contacts.lock().unwrap().len(), 4);
    assert_eq!(crm.entries.lock().unwrap().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_record_a_stopped_write_recorded_is_reused(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-marker", team).await;
    let crm = crm_for(team, &[&owner]);
    let planned = plan(
        &pool,
        portal("hubspot-marker@example.com"),
        crm.clone(),
        &owner,
    )
    .await;
    // A write that stopped after making the pipeline and recording it, before
    // the ledger row was marked imported.
    let pipeline = crm
        .create_deal_pipeline(&owner, "Sales Pipeline", &[])
        .await
        .unwrap();
    let row = row_id(&pool, &owner, "pipeline:default").await;
    PgImportRepo::new(pool.clone())
        .record_written(
            &owner,
            &[WrittenObject::own(row, WrittenKind::CrmRecord, pipeline)],
        )
        .await
        .unwrap();

    let report = finish(planned, &owner, NotionWriteChoices::default()).await;
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(crm.pipelines.lock().unwrap().len(), 1);
    let entries = crm.entries.lock().unwrap().clone();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().all(|(_, p, _)| *p == pipeline));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_companys_entries_are_read_once_per_write(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-entry-reads", team).await;
    let crm = crm_for(team, &[&owner]);
    let mut inventory = portal("hubspot-entry-reads@example.com");
    // Four deals on Acme in one pipeline, one on the gmail company.
    let acme = inventory.deals[0].clone();
    for record in ["33", "34", "35"] {
        inventory.deals.push(Deal {
            id: id(record),
            name: Some(format!("Deal {record}")),
            ..acme.clone()
        });
    }

    let report = import(&pool, inventory, crm.clone(), &owner).await;
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(crm.entries.lock().unwrap().len(), 5);
    // One read per company and pipeline, not one per deal.
    assert_eq!(crm.entry_reads.load(std::sync::atomic::Ordering::SeqCst), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_object_cut_short_by_shutdown_is_left_for_the_next_worker(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-handover", team).await;
    let crm = crm_for(team, &[&owner]);
    let shutdown = CancellationToken::new();
    *crm.stop_on_create.lock().unwrap() = Some(("Acme".into(), shutdown.clone()));
    let tracker = TaskTracker::new();
    let service = service(&pool, Writer::default(), shutdown, tracker.clone()).with_hubspot(
        Arc::new(Reader(portal("hubspot-handover@example.com"))),
        crm.clone(),
    );
    service
        .prepare_workspace_import(&owner, ImportSource::Hubspot, None, Duration::from_secs(60))
        .await
        .unwrap();
    let review = present(&pool, &service, &owner).await;
    service
        .start_workspace_write(
            &owner,
            ImportSource::Hubspot,
            review,
            NotionWriteChoices::default(),
        )
        .await
        .unwrap();
    tracker.close();
    tracker.wait().await;

    let rows = PgImportRepo::new(pool)
        .list(&owner, Some(ImportSource::Hubspot), None)
        .await
        .unwrap();
    let acme = rows
        .iter()
        .find(|row| row.foreign_id == "248109388:company:10")
        .unwrap();
    // Still importing: the next process adopts the run and finishes it.
    assert_eq!(acme.status, ImportStatus::Importing, "{acme:?}");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_record_the_ledger_did_not_take_is_not_linked_to(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-settled", team).await;
    let crm = crm_for(team, &[&owner]);
    *crm.settle_on_create.lock().unwrap() =
        Some(("Acme".into(), pool.clone(), "248109388:company:10".into()));

    import(
        &pool,
        portal("hubspot-settled@example.com"),
        crm.clone(),
        &owner,
    )
    .await;

    let acme = crm
        .companies
        .lock()
        .unwrap()
        .iter()
        .find(|(_, name, _)| name == "Acme")
        .map(|(id, ..)| *id)
        .unwrap();
    // Its row ended elsewhere, so nothing was filed under the company.
    let contacts = crm.contacts.lock().unwrap();
    assert!(
        contacts
            .iter()
            .all(|(_, contact)| contact.company != Some(acme)),
        "{contacts:?}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_company_a_teammate_finishes_during_the_write_is_filed_under(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-late-company", team).await;
    let crm = crm_for(team, &[&owner]);
    let planned = plan(
        &pool,
        portal("hubspot-late-company@example.com"),
        crm.clone(),
        &owner,
    )
    .await;
    let acme_row = row_id(&pool, &owner, "company:10").await;
    let pipeline_row = row_id(&pool, &owner, "pipeline:default").await;
    // Acme waits on a teammate's copy when the write starts...
    sqlx::query!(
        "UPDATE import_entity SET waiting_on = $1 WHERE id = $2",
        pipeline_row,
        acme_row
    )
    .execute(&pool)
    .await
    .unwrap();
    // ...and the teammate's write links it while this one makes the pipeline.
    let acme = Uuid::now_v7();
    *crm.on_pipeline.lock().unwrap() = Some((pool.clone(), acme_row, acme));

    finish(planned, &owner, NotionWriteChoices::default()).await;

    // Its contacts are filed under the linked company, not failed.
    let contacts = crm.contacts.lock().unwrap();
    assert!(
        contacts
            .iter()
            .any(|(_, contact)| contact.company == Some(acme)),
        "{contacts:?}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deal_entry_is_found_again_whatever_host_its_link_names(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "hubspot-host", team).await;
    let crm = crm_for(team, &[&owner]);
    // The entry is made with the EU host, then the process stops before the
    // ledger records it.
    crm.crash_after_create
        .lock()
        .unwrap()
        .insert("Deal 31".to_owned());
    let mut eu = portal("hubspot-host@example.com");
    eu.portal.ui_domain = Some("app-eu1.hubspot.com".into());
    import(&pool, eu.clone(), crm.clone(), &owner).await;

    // The next plan names no host, so links use the default one.
    let mut unnamed = eu;
    unnamed.portal.ui_domain = None;
    let report = import(&pool, unnamed, crm.clone(), &owner).await;

    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert_eq!(crm.entries.lock().unwrap().len(), 2);
}
