//! An Attio import end to end against the real ledger and an in-memory CRM,
//! read by the real `import_attio` client through the connectors fake from
//! the labelled Attio MCP stand-in (synthetic records in the ASSUMED output
//! shape, not Attio), with pages capped to force paging.

use std::time::Duration;

use connectors::fake::{FakeConnection, FakeConnectors};
use import_attio::outbound::client::AttioMcp;
use import_attio::standin::AttioStandin;

use super::hubspot::{Crm, crm_for};
use super::*;
use crate::domain::models::{CrmLoss, CrmLossCount, NotionImportReport};
use crate::domain::ports::DealOutcome;
use crate::domain::service::WorkspaceImporter;

/// Every import's rollout, on or off for everyone.
struct Rollout(bool);

#[async_trait::async_trait]
impl crate::domain::ports::ImportRollout for Rollout {
    async fn enabled_for(&self, _user: &MacroUserIdStr<'static>, _source: ImportSource) -> bool {
        self.0
    }
}

/// The stand-in workspace's id and URL slug.
const WORKSPACE: &str = "5d5d5d5d-0000-4000-8000-000000000001";
const SLUG: &str = "standin-synthetic";

fn attio_service(
    pool: &PgPool,
    owner: &MacroUserIdStr<'static>,
    standin: AttioStandin,
    crm: Arc<Crm>,
    tracker: TaskTracker,
) -> Service {
    let connectors = FakeConnectors::new()
        .with_overlay("attio", "https://mcp.attio.com/mcp")
        .with_connection(owner, FakeConnection::app("attio").served_by(standin))
        .build();
    service(pool, Writer::default(), CancellationToken::new(), tracker)
        .with_attio(Arc::new(AttioMcp::new(Arc::new(connectors))))
        .with_import_rollout(Arc::new(Rollout(true)))
        .with_crm_writer(crm)
}

/// A review for `owner`'s Attio plan, as the agent presents it.
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
            ImportSource::Attio,
            review,
            AgentSessionId::new_from_uuid(session),
        )
        .await
        .unwrap();
    review
}

/// Plan, present, approve and finish writing one Attio import.
async fn import(
    pool: &PgPool,
    standin: AttioStandin,
    crm: Arc<Crm>,
    owner: &MacroUserIdStr<'static>,
) -> NotionImportReport {
    let tracker = TaskTracker::new();
    let service = attio_service(pool, owner, standin, crm, tracker.clone());
    let planned = service
        .prepare_workspace_import(owner, ImportSource::Attio, None, Duration::from_secs(60))
        .await
        .unwrap();
    assert_eq!(planned.status, Some(RunStatus::Ready), "{planned:?}");
    let review = present(pool, &service, owner).await;
    match service
        .start_workspace_write(
            owner,
            ImportSource::Attio,
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
        .workspace_import_report(owner, ImportSource::Attio)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imports_the_stand_in_workspace_into_the_crm_and_reruns_add_nothing(pool: PgPool) {
    let team = Uuid::now_v7();
    // The stand-in's first member is standin-owner@example.com.
    let owner = teammate(&pool, "standin-owner", team).await;
    let crm = crm_for(team, &[&owner]);
    let standin = || AttioStandin::new().with_page_cap(2);

    let report = import(&pool, standin(), crm.clone(), &owner).await;

    // Attio's live deal stages become one pipeline, in order.
    let pipelines = crm.pipelines.lock().unwrap().clone();
    assert_eq!(pipelines.len(), 1);
    assert_eq!(pipelines[0].1, "Attio deals");
    assert_eq!(pipelines[0].2, ["Lead", "In Progress", "Won", "Lost"]);

    // Every company, keyed by its first domain.
    let companies = crm.companies.lock().unwrap().clone();
    assert_eq!(companies.len(), 5, "{companies:?}");
    let (anvils, _, _) = companies
        .iter()
        .find(|(_, _, domain)| domain.as_deref() == Some("anvils.standin.test"))
        .unwrap()
        .clone();
    assert!(
        companies
            .iter()
            .any(|(_, name, domain)| name == "nameless.standin.test"
                && domain.as_deref() == Some("nameless.standin.test"))
    );

    // People become contacts with every address, under their company.
    let contacts = crm.contacts.lock().unwrap().clone();
    assert_eq!(contacts.len(), 3);
    let ada = contacts
        .iter()
        .find(|(_, contact)| contact.name == "Ada Standin")
        .unwrap()
        .1
        .clone();
    assert_eq!(ada.emails, ["ada@anvils.standin.test"]);
    assert_eq!(ada.company, Some(anvils));

    // The celebrated stage is won; the deal with no company is not written.
    let entries = crm.entries.lock().unwrap().clone();
    assert_eq!(entries.len(), 2, "{entries:?}");
    let won = entries
        .iter()
        .find(|(_, _, entry)| entry.name == "Anvil order (synthetic)")
        .unwrap()
        .2
        .clone();
    assert_eq!(won.company, anvils);
    assert_eq!(won.stage.as_deref(), Some("Won"));
    assert_eq!(won.outcome, DealOutcome::Won);
    assert_eq!(won.amount, Some(4200.0));
    assert_eq!(won.currency.as_deref(), Some("USD"));
    // Its owner is a workspace member outside the team: left unassigned.
    assert_eq!(won.owner, None);
    let pilot = entries
        .iter()
        .find(|(_, _, entry)| entry.name == "Rocket pilot (synthetic)")
        .unwrap()
        .2
        .clone();
    assert_eq!(pilot.outcome, DealOutcome::Open);
    assert_eq!(pilot.stage.as_deref(), Some("In Progress"));
    // The owner is stored as the matched member's Macro user id.
    assert_eq!(pilot.owner.as_deref(), Some(owner.as_ref()));
    assert!(
        won.link
            .starts_with(&format!("https://app.attio.com/{SLUG}/deal/")),
        "{}",
        won.link
    );

    assert_eq!(report.status, Some(RunStatus::Completed), "{report:?}");
    assert!(report.failures.is_empty(), "{:?}", report.failures);
    assert!(report.hubspot.is_none());
    let attio = report.attio.unwrap();
    assert_eq!(
        (
            attio.pipelines,
            attio.companies,
            attio.contacts,
            attio.deals
        ),
        (1, 5, 3, 3)
    );
    for loss in [
        CrmLoss::DealWithoutCompany,
        CrmLoss::OwnerNotMember,
        CrmLoss::AdditionalDomains,
    ] {
        assert!(
            attio.losses.contains(&CrmLossCount { loss, count: 1 }),
            "{loss:?} in {:?}",
            attio.losses
        );
    }
    assert_eq!((attio.owners, attio.owners_matched), (2, 1));
    assert!(
        attio
            .custom_properties
            .contains(&"companies.standin_tier".to_owned()),
        "{:?}",
        attio.custom_properties
    );
    // Every ledger row is keyed by the workspace.
    let rows = PgImportRepo::new(pool.clone())
        .list(&owner, Some(ImportSource::Attio), None)
        .await
        .unwrap();
    assert!(
        rows.iter()
            .all(|row| row.foreign_id.starts_with(&format!("{WORKSPACE}:"))),
        "{:?}",
        rows.iter().map(|row| &row.foreign_id).collect::<Vec<_>>()
    );

    // A second run of the same workspace creates nothing.
    import(&pool, standin(), crm.clone(), &owner).await;
    assert_eq!(crm.pipelines.lock().unwrap().len(), 1);
    assert_eq!(crm.companies.lock().unwrap().len(), 5);
    assert_eq!(crm.contacts.lock().unwrap().len(), 3);
    assert_eq!(crm.entries.lock().unwrap().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn without_deals_companies_and_people_still_import(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "standin-owner", team).await;
    let crm = crm_for(team, &[&owner]);

    let report = import(
        &pool,
        AttioStandin::new().without_deals(),
        crm.clone(),
        &owner,
    )
    .await;

    assert_eq!(report.status, Some(RunStatus::Completed), "{report:?}");
    assert!(crm.pipelines.lock().unwrap().is_empty());
    assert!(crm.entries.lock().unwrap().is_empty());
    assert_eq!(crm.companies.lock().unwrap().len(), 5);
    assert_eq!(crm.contacts.lock().unwrap().len(), 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn without_an_attio_connection_the_user_is_asked_to_connect(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "standin-owner", team).await;
    let crm = crm_for(team, &[&owner]);
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    )
    .with_attio(Arc::new(AttioMcp::new(Arc::new(
        FakeConnectors::new().build(),
    ))))
    .with_import_rollout(Arc::new(Rollout(true)))
    .with_crm_writer(crm);

    let error = service
        .prepare_workspace_import(&owner, ImportSource::Attio, None, Duration::from_secs(5))
        .await
        .unwrap_err();

    assert!(
        matches!(
            error,
            ImportError::Attio(import_attio::domain::AttioError::NotConnected)
        ),
        "{error:?}"
    );
    assert!(
        service
            .workspace_import_report(&owner, ImportSource::Attio)
            .await
            .unwrap()
            .status
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn with_the_rollout_off_a_plan_is_refused_before_reading_attio(pool: PgPool) {
    let team = Uuid::now_v7();
    let owner = teammate(&pool, "standin-owner", team).await;
    let crm = crm_for(team, &[&owner]);
    let fake = FakeConnectors::new()
        .with_overlay("attio", "https://mcp.attio.com/mcp")
        .with_connection(
            &owner,
            FakeConnection::app("attio").answering_tool("whoami", []),
        );
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    )
    .with_attio(Arc::new(AttioMcp::new(Arc::new(fake.build()))))
    .with_import_rollout(Arc::new(Rollout(false)))
    .with_crm_writer(crm);

    let error = service
        .prepare_workspace_import(&owner, ImportSource::Attio, None, Duration::from_secs(5))
        .await
        .unwrap_err();

    assert!(
        matches!(error, ImportError::NotRolledOut(ImportSource::Attio)),
        "{error:?}"
    );
    assert!(fake.mcp_calls().is_empty());
    assert!(
        service
            .workspace_import_report(&owner, ImportSource::Attio)
            .await
            .unwrap()
            .status
            .is_none()
    );
}

/// An Attio run planned while the flag was on, adopted after it went off:
/// planning refuses before calling a single Attio tool.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_adopted_run_after_the_flag_went_off_calls_no_attio_tool(pool: PgPool) {
    use crate::domain::service::workspace::Importer;

    let team = Uuid::now_v7();
    let owner = teammate(&pool, "standin-owner", team).await;
    let fake = FakeConnectors::new()
        .with_overlay("attio", "https://mcp.attio.com/mcp")
        .with_connection(
            &owner,
            FakeConnection::app("attio").answering_tool("whoami", []),
        );
    let service = service(
        &pool,
        Writer::default(),
        CancellationToken::new(),
        TaskTracker::new(),
    )
    .with_attio(Arc::new(AttioMcp::new(Arc::new(fake.build()))))
    .with_import_rollout(Arc::new(Rollout(false)))
    .with_crm_writer(crm_for(team, &[&owner]))
    .scoped(ImportSource::Attio);

    let error = service
        .plan(
            &owner,
            import_notion::domain::model::ImportScope::Everything,
            NotionSharing::Team,
            &JobControl::new(CancellationToken::new()),
        )
        .await
        .unwrap_err();

    assert!(
        matches!(error, ImportError::NotRolledOut(ImportSource::Attio)),
        "{error:?}"
    );
    assert!(fake.mcp_calls().is_empty());
}
