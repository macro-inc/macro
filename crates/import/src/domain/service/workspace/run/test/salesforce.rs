//! A Salesforce import against the real ledger and the in-memory CRM of the
//! HubSpot tests: plan, approve, write through the shared CRM write, re-run,
//! a teammate's import, and the checks made before a run starts.

use std::time::Duration;

use async_trait::async_trait;
use import_salesforce::domain::{
    Account, Contact, Inventory, Opportunity, Org, Owner, ReadProgress, RecordId,
    SalesforceConnections, SalesforceError, Stage,
};

use super::hubspot::{Crm, crm_for};
use super::*;
use crate::domain::models::{CrmLoss, CrmLossCount, NotionImportReport};
use crate::domain::ports::{DealOutcome, ImportError};
use crate::domain::service::WorkspaceImporter;

fn id(value: &str) -> RecordId {
    RecordId::try_from(value.to_owned()).unwrap()
}

const ORG: &str = "00D000000000001AAA";

fn stage(api_name: &str, closed: bool, won: bool) -> Stage {
    Stage {
        api_name: api_name.into(),
        label: api_name.into(),
        sort_order: 0,
        closed,
        won,
        probability: None,
    }
}

/// A small org whose first owner is `owner_email`: two accounts on one
/// domain, a personal-provider account, three contacts and three
/// opportunities.
fn org(owner_email: &str) -> Inventory {
    let opportunity = |record: &str, stage: &str, account: Option<&str>| Opportunity {
        id: id(record),
        name: Some(format!("Opportunity {record}")),
        stage: Some(stage.into()),
        amount: Some(500.0),
        currency: None,
        close_date: Some("2026-06-30".into()),
        account: account.map(id),
        owner: Some(id("005000000000001AAA")),
        closed: false,
        won: false,
    };
    Inventory {
        org: Org {
            id: id(ORG),
            instance_url: Some("https://acme.my.salesforce.com".into()),
            currency: Some("USD".into()),
        },
        owners: vec![
            Owner {
                id: id("005000000000001AAA"),
                email: Some(owner_email.to_uppercase()),
                active: true,
            },
            Owner {
                id: id("005000000000002AAA"),
                email: Some("outsider@example.org".into()),
                active: true,
            },
        ],
        stages: vec![
            stage("Prospecting", false, false),
            stage("Closed Won", true, true),
            stage("Closed Lost", true, false),
        ],
        accounts: vec![
            Account {
                id: id("001000000000001AAA"),
                name: Some("Acme".into()),
                website: Some("https://acme.example".into()),
                owner: None,
            },
            Account {
                id: id("001000000000002AAA"),
                name: Some("Acme EU".into()),
                website: Some("www.ACME.example".into()),
                owner: Some(id("005000000000002AAA")),
            },
            Account {
                id: id("001000000000003AAA"),
                name: Some("Personal".into()),
                website: Some("gmail.com".into()),
                owner: None,
            },
        ],
        contacts: vec![
            Contact {
                id: id("003000000000001AAA"),
                first_name: Some("Ada".into()),
                last_name: None,
                email: Some("ada@acme.example".into()),
                account: Some(id("001000000000001AAA")),
                owner: None,
            },
            Contact {
                id: id("003000000000002AAA"),
                first_name: Some("Bo".into()),
                last_name: None,
                email: None,
                account: None,
                owner: None,
            },
            Contact {
                id: id("003000000000003AAA"),
                first_name: Some("Cy".into()),
                last_name: None,
                email: Some("cy@acme.example".into()),
                account: Some(id("001000000000003AAA")),
                owner: None,
            },
        ],
        opportunities: vec![
            Opportunity {
                closed: true,
                won: true,
                ..opportunity(
                    "006000000000001AAA",
                    "Closed Won",
                    Some("001000000000001AAA"),
                )
            },
            Opportunity {
                owner: Some(id("005000000000002AAA")),
                ..opportunity(
                    "006000000000002AAA",
                    "Prospecting",
                    Some("001000000000003AAA"),
                )
            },
            // No account: skipped.
            opportunity("006000000000003AAA", "Prospecting", None),
        ],
        warnings: Vec::new(),
    }
}

struct Reader(Inventory);

#[async_trait]
impl SalesforceConnections for Reader {
    async fn connected(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<bool, SalesforceError> {
        Ok(true)
    }
    async fn inventory(
        &self,
        _: &MacroUserIdStr<'static>,
        progress: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> std::result::Result<Inventory, SalesforceError> {
        progress(ReadProgress {
            accounts: self.0.accounts.len(),
            contacts: self.0.contacts.len(),
            opportunities: self.0.opportunities.len(),
        });
        Ok(self.0.clone())
    }
}

/// A user who has not connected Salesforce.
struct Disconnected;

#[async_trait]
impl SalesforceConnections for Disconnected {
    async fn connected(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> std::result::Result<bool, SalesforceError> {
        Ok(false)
    }
    async fn inventory(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &(dyn Fn(ReadProgress) + Send + Sync),
    ) -> std::result::Result<Inventory, SalesforceError> {
        Err(SalesforceError::NotConnected)
    }
}

/// Plan, present, approve and finish writing one Salesforce import.
async fn import(
    pool: &PgPool,
    inventory: Inventory,
    crm: Arc<Crm>,
    owner: &MacroUserIdStr<'static>,
) -> NotionImportReport {
    let tracker = TaskTracker::new();
    let service = service(
        pool,
        Writer::default(),
        CancellationToken::new(),
        tracker.clone(),
    )
    .with_salesforce(Arc::new(Reader(inventory)))
    .with_crm_writer(crm);
    let planned = service
        .prepare_workspace_import(
            owner,
            ImportSource::Salesforce,
            None,
            Duration::from_secs(60),
        )
        .await
        .unwrap();
    assert_eq!(planned.status, Some(RunStatus::Ready), "{planned:?}");

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
            ImportSource::Salesforce,
            review,
            AgentSessionId::new_from_uuid(session),
        )
        .await
        .unwrap();
    match service
        .start_workspace_write(
            owner,
            ImportSource::Salesforce,
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
        .workspace_import_report(owner, ImportSource::Salesforce)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn writes_an_org_into_the_crm_and_reruns_add_nothing(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "salesforce-owner", team).await;
    let crm = crm_for(team, &[&owner]);
    let inventory = org("salesforce-owner@example.com");

    let report = import(&pool, inventory.clone(), crm.clone(), &owner).await;

    assert!(report.failures.is_empty(), "{:?}", report.failures);
    // The org's stages, in order, as one pipeline.
    let pipelines = crm.pipelines.lock().unwrap().clone();
    assert_eq!(pipelines.len(), 1);
    assert_eq!(pipelines[0].1, "Salesforce opportunities");
    assert_eq!(pipelines[0].2, ["Prospecting", "Closed Won", "Closed Lost"]);

    // Two accounts on one domain become one CRM company; a personal provider
    // is created by name only.
    let companies = crm.companies.lock().unwrap().clone();
    assert_eq!(companies.len(), 2, "{companies:?}");
    let (acme, _, _) = companies
        .iter()
        .find(|(_, _, domain)| domain.as_deref() == Some("acme.example"))
        .unwrap()
        .clone();
    let (personal, _, _) = companies
        .iter()
        .find(|(_, name, _)| name == "Personal")
        .unwrap()
        .clone();

    // Contacts are filed under their account.
    let contacts = crm.contacts.lock().unwrap().clone();
    assert_eq!(contacts.len(), 3);
    let company_of = |name: &str| {
        contacts
            .iter()
            .find(|(_, contact)| contact.name == name)
            .unwrap()
            .1
            .company
    };
    assert_eq!(company_of("Ada"), Some(acme));
    assert_eq!(company_of("Bo"), None);
    assert_eq!(company_of("Cy"), Some(personal));

    // Opportunities with an account become entries; the owner is a member
    // on one, an outsider on the other.
    let entries = crm.entries.lock().unwrap().clone();
    assert_eq!(entries.len(), 2);
    let won = entries
        .iter()
        .find(|(_, _, entry)| entry.outcome == DealOutcome::Won)
        .unwrap();
    assert_eq!(won.1, pipelines[0].0);
    assert_eq!(won.2.company, acme);
    assert_eq!(won.2.stage.as_deref(), Some("Closed Won"));
    assert_eq!(won.2.owner.as_deref(), Some(owner.as_ref()));
    assert_eq!(
        (won.2.amount, won.2.currency.as_deref()),
        (Some(500.0), Some("USD"))
    );
    assert_eq!(
        won.2.link,
        "https://acme.my.salesforce.com/lightning/r/Opportunity/006000000000001AAA/view"
    );
    let open = entries
        .iter()
        .find(|(_, _, entry)| entry.outcome == DealOutcome::Open)
        .unwrap();
    assert_eq!(open.2.owner, None);

    // The report's Salesforce section.
    let salesforce = report.salesforce.clone().unwrap();
    assert_eq!(
        (
            salesforce.pipelines,
            salesforce.companies,
            salesforce.contacts,
            salesforce.deals
        ),
        (1, 3, 3, 3)
    );
    assert_eq!((salesforce.owners, salesforce.owners_matched), (2, 1));
    assert!(
        salesforce.losses.contains(&CrmLossCount {
            loss: CrmLoss::DealWithoutCompany,
            count: 1
        }),
        "{:?}",
        salesforce.losses
    );
    assert!(salesforce.created > 0);

    // A re-run plans nothing new and writes nothing.
    let rerun = import(&pool, inventory, crm.clone(), &owner).await;
    assert!(rerun.failures.is_empty(), "{:?}", rerun.failures);
    assert_eq!(crm.pipelines.lock().unwrap().len(), 1);
    assert_eq!(crm.companies.lock().unwrap().len(), 2);
    assert_eq!(crm.contacts.lock().unwrap().len(), 3);
    assert_eq!(crm.entries.lock().unwrap().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_teammate_importing_the_same_org_links_the_team_copy(pool: PgPool) {
    let team = Uuid::now_v7();
    let first = teammate(&pool, "salesforce-first", team).await;
    let second = teammate(&pool, "salesforce-second", team).await;
    let crm = crm_for(team, &[&first, &second]);
    let inventory = org("salesforce-first@example.com");

    import(&pool, inventory.clone(), crm.clone(), &first).await;
    let report = import(&pool, inventory, crm.clone(), &second).await;

    assert!(report.failures.is_empty(), "{:?}", report.failures);
    // Nothing is created twice.
    assert_eq!(crm.pipelines.lock().unwrap().len(), 1);
    assert_eq!(crm.companies.lock().unwrap().len(), 2);
    assert_eq!(crm.contacts.lock().unwrap().len(), 3);
    assert_eq!(crm.entries.lock().unwrap().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn without_a_connection_the_user_is_asked_to_connect_and_no_import_fails(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "salesforce-unconnected", team).await;
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    )
    .with_salesforce(Arc::new(Disconnected))
    .with_crm_writer(crm_for(team, &[&owner]));

    let result = service
        .prepare_workspace_import(
            &owner,
            ImportSource::Salesforce,
            None,
            Duration::from_secs(5),
        )
        .await;

    assert!(
        matches!(
            result,
            Err(ImportError::Salesforce(SalesforceError::NotConnected))
        ),
        "{result:?}"
    );
    // No run was started, so nothing shows a failed import.
    let report = service
        .workspace_import_report(&owner, ImportSource::Salesforce)
        .await
        .unwrap();
    assert_eq!(report.status, None, "{report:?}");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn without_crm_access_nothing_is_planned(pool: PgPool) {
    let owner = teammate(&pool, "salesforce-denied", Uuid::now_v7()).await;
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    )
    .with_salesforce(Arc::new(Reader(org("salesforce-denied@example.com"))))
    .with_crm_writer(Arc::new(Crm::default()));

    let result = service
        .prepare_workspace_import(
            &owner,
            ImportSource::Salesforce,
            None,
            Duration::from_secs(5),
        )
        .await;

    assert!(
        matches!(result, Err(ImportError::CrmAccessRequired)),
        "{result:?}"
    );
    let report = service
        .workspace_import_report(&owner, ImportSource::Salesforce)
        .await
        .unwrap();
    assert_eq!(report.status, None, "{report:?}");
}
