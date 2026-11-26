use std::sync::Arc;

use connectors::fake::{FakeConnection, FakeConnectors};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::AttioStandin;
use crate::domain::{
    AttioConnections, CustomAttributes, Money, Object, ReadProgress, RecordId, StageId,
};
use crate::outbound::client::AttioMcp;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn uuid(value: &str) -> Uuid {
    value.parse().unwrap()
}

fn served(standin: AttioStandin) -> AttioMcp<connectors::Connectors> {
    let fake = FakeConnectors::new()
        .with_overlay("attio", "https://mcp.attio.com/mcp")
        .with_connection(&user(), FakeConnection::app("attio").served_by(standin));
    AttioMcp::new(Arc::new(fake.build()))
}

#[tokio::test(start_paused = true)]
async fn the_importer_reads_the_whole_stand_in_workspace_through_capped_pages() {
    let attio = served(AttioStandin::new().with_page_cap(2));
    let seen = std::sync::Mutex::new(Vec::new());

    let inventory = attio
        .inventory(&user(), &|progress| seen.lock().unwrap().push(progress))
        .await
        .unwrap();

    assert_eq!(
        inventory.workspace.id,
        uuid("5d5d5d5d-0000-4000-8000-000000000001")
    );
    assert_eq!(
        inventory.workspace.slug.as_deref(),
        Some("standin-synthetic")
    );
    assert_eq!(inventory.members.len(), 2);
    assert_eq!(
        inventory
            .stages
            .iter()
            .map(|stage| (
                stage.title.as_str(),
                stage.celebration_enabled,
                stage.archived
            ))
            .collect::<Vec<_>>(),
        vec![
            ("Lead", false, false),
            ("In Progress", false, false),
            ("Won", true, false),
            ("Lost", false, false),
            ("Retired", false, true),
        ]
    );
    assert_eq!(
        inventory
            .companies
            .iter()
            .map(|company| company.id)
            .collect::<Vec<_>>(),
        vec![
            RecordId(uuid("5c0c0000-0000-4000-8000-000000000001")),
            RecordId(uuid("5c0c0000-0000-4000-8000-000000000002")),
            RecordId(uuid("5c0c0000-0000-4000-8000-000000000003")),
            RecordId(uuid("5c0c0000-0000-4000-8000-000000000004")),
            RecordId(uuid("5c0c0000-0000-4000-8000-000000000005")),
        ]
    );
    assert_eq!(inventory.companies[4].name, None);
    assert_eq!(inventory.people.len(), 3);
    assert_eq!(
        inventory.people[1].emails,
        vec!["bo@rockets.standin.test", "bo.standin@example.com"]
    );
    assert_eq!(
        inventory.people[1].company,
        Some(RecordId(uuid("5c0c0000-0000-4000-8000-000000000002")))
    );
    assert_eq!(inventory.deals.len(), 3);
    assert_eq!(
        inventory.deals[1].stage,
        Some(StageId(uuid("5a5a0000-0000-4000-8000-000000000002")))
    );
    assert_eq!(
        inventory.deals[1].value,
        Some(Money {
            amount: 950.25,
            currency: Some("EUR".into())
        })
    );
    assert_eq!(inventory.deals[2].company, None);
    assert_eq!(
        inventory.custom_attributes,
        vec![
            CustomAttributes {
                object: Object::Companies,
                slugs: vec!["standin_tier".into()],
            },
            CustomAttributes {
                object: Object::Deals,
                slugs: vec!["standin_region".into()],
            },
        ]
    );
    assert_eq!(inventory.warnings, Vec::<String>::new());
    assert_eq!(
        seen.into_inner().unwrap().last(),
        Some(&ReadProgress {
            companies: 5,
            people: 3,
            deals: 3
        })
    );
}

#[tokio::test(start_paused = true)]
async fn a_stand_in_without_deals_imports_companies_and_people_only() {
    let attio = served(AttioStandin::new().without_deals());

    let inventory = attio.inventory(&user(), &|_| {}).await.unwrap();

    assert_eq!(inventory.companies.len(), 5);
    assert_eq!(inventory.people.len(), 3);
    assert!(inventory.deals.is_empty());
    assert!(inventory.stages.is_empty());
    assert_eq!(inventory.warnings.len(), 1);
}
