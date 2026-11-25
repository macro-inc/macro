use super::*;
use connectors::fake::{FakeConnection, FakeConnectors};
use connectors::{ApiResponse, Connectors};
use http::{HeaderMap, StatusCode};
use std::sync::Mutex;
use strum::IntoEnumIterator;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn fixture(name: &str) -> ApiResponse {
    let body = match name {
        "account" => include_str!("fixtures/account.json"),
        "owners_page1" => include_str!("fixtures/owners_page1.json"),
        "owners_page2" => include_str!("fixtures/owners_page2.json"),
        "owners_archived" => include_str!("fixtures/owners_archived.json"),
        "pipelines" => include_str!("fixtures/pipelines.json"),
        "companies_page1" => include_str!("fixtures/companies_page1.json"),
        "companies_page2" => include_str!("fixtures/companies_page2.json"),
        "contacts_page1" => include_str!("fixtures/contacts_page1.json"),
        "contact_7001_companies_v4" => include_str!("fixtures/contact_7001_companies_v4.json"),
        "deals_page1" => include_str!("fixtures/deals_page1.json"),
        "properties_companies" => include_str!("fixtures/properties_companies.json"),
        "properties_contacts" => include_str!("fixtures/properties_contacts.json"),
        "properties_deals" => include_str!("fixtures/properties_deals.json"),
        other => panic!("no fixture {other}"),
    };
    answer(StatusCode::OK, body)
}

fn answer(status: StatusCode, body: &str) -> ApiResponse {
    ApiResponse {
        status,
        headers: HeaderMap::new(),
        body: body.to_owned(),
    }
}

fn connected(responses: Vec<ApiResponse>) -> (FakeConnectors, Arc<Connectors>) {
    let fake = FakeConnectors::new()
        .with_catalog_app(HUBSPOT_APP)
        .with_connection(
            &user(),
            FakeConnection::app(HUBSPOT_APP).answering_in_turn(responses),
        );
    let service = Arc::new(fake.build());
    (fake, service)
}

fn connections(service: Arc<Connectors>) -> HubspotApi<Connectors> {
    HubspotApi::with_interval(service, Duration::ZERO)
}

/// Every fixture, in the order a full read asks for them.
fn full_portal() -> Vec<ApiResponse> {
    [
        "account",
        "owners_page1",
        "owners_page2",
        "owners_archived",
        "pipelines",
        "companies_page1",
        "companies_page2",
        "contacts_page1",
        "contact_7001_companies_v4",
        "deals_page1",
        "properties_companies",
        "properties_contacts",
        "properties_deals",
    ]
    .into_iter()
    .map(fixture)
    .collect()
}

fn id(value: &str) -> RecordId {
    RecordId::try_from(value.to_owned()).unwrap()
}

fn key(value: &str) -> PipelineKey {
    PipelineKey::try_from(value.to_owned()).unwrap()
}

#[test]
fn every_read_is_a_fixed_get_or_batch_read_on_the_crm_api() {
    let reads = [
        HubspotRead::AccountDetails,
        HubspotRead::Owners { archived: false },
        HubspotRead::Owners { archived: true },
        HubspotRead::DealPipelines,
    ]
    .into_iter()
    .chain(ObjectType::iter().map(HubspotRead::Objects))
    .chain(ObjectType::iter().map(HubspotRead::Properties))
    .chain(
        ObjectType::iter()
            .filter(|o| *o != ObjectType::Company)
            .map(|from| HubspotRead::CompanyLinks { from, id: id("42") }),
    );
    for read in reads {
        let url = read.url(Some("a&b=c")).unwrap();
        assert!(url.starts_with("https://api.hubapi.com/"), "{url}");
        assert!(!url.contains("b=c"), "cursor must be encoded: {url}");
        assert_eq!(read.method(), Method::GET);
    }
}

#[tokio::test(start_paused = true)]
async fn reads_a_whole_portal() {
    let (fake, service) = connected(full_portal());
    let seen = Mutex::new(Vec::new());
    let inventory = connections(service)
        .inventory(&user(), &|progress| seen.lock().unwrap().push(progress))
        .await
        .unwrap();

    assert_eq!(
        inventory.portal,
        Portal {
            id: 248109388,
            currency: Some("USD".into()),
            ui_domain: Some("app.hubspot.com".into()),
        }
    );
    assert_eq!(
        inventory.owners,
        vec![
            Owner {
                id: id("101"),
                email: Some("ada@example.com".into()),
                archived: false
            },
            Owner {
                id: id("102"),
                email: Some("nomacro@example.org".into()),
                archived: false
            },
            Owner {
                id: id("103"),
                email: Some("gone@example.com".into()),
                archived: true
            },
        ]
    );

    // Pipelines and stages in display order; archived ones left out.
    assert_eq!(
        inventory
            .pipelines
            .iter()
            .map(|p| (
                p.label.as_str(),
                p.stages
                    .iter()
                    .map(|s| s.label.as_str())
                    .collect::<Vec<_>>()
            ))
            .collect::<Vec<_>>(),
        vec![
            (
                "Sales Pipeline",
                vec!["Appointment scheduled", "Closed won", "Closed lost"]
            ),
            ("Partners", vec!["Intro", "Signed"]),
        ]
    );
    let won = &inventory.pipelines[0].stages[1];
    assert_eq!(
        won,
        &Stage {
            id: key("closedwon"),
            label: "Closed won".into(),
            closed: true,
            probability: Some(1.0),
        }
    );

    assert_eq!(
        inventory.companies,
        vec![
            Company {
                id: id("5001"),
                name: Some("Acme".into()),
                domain: Some("acme.example".into()),
                website: Some("https://acme.example".into()),
                additional_domains: vec!["acme-io.example".into(), "acme-labs.example".into()],
                owner: Some(id("101")),
            },
            Company {
                id: id("5002"),
                name: None,
                domain: None,
                website: Some("http://www.globex.example/about".into()),
                additional_domains: vec![],
                owner: None,
            },
            Company {
                id: id("5003"),
                name: Some("Gmail person".into()),
                domain: Some("gmail.com".into()),
                website: None,
                additional_domains: vec![],
                owner: None,
            },
        ]
    );

    assert_eq!(
        inventory.contacts,
        vec![
            Contact {
                id: id("7001"),
                first_name: Some("Grace".into()),
                last_name: Some("Hopper".into()),
                email: Some("grace@acme.example".into()),
                additional_emails: vec![
                    "g.hopper@acme-io.example".into(),
                    "grace.home@example.net".into()
                ],
                companies: vec![
                    CompanyLink {
                        company: id("5001"),
                        primary: true
                    },
                    CompanyLink {
                        company: id("5002"),
                        primary: false
                    },
                    CompanyLink {
                        company: id("5003"),
                        primary: false
                    },
                ],
                owner: Some(id("102")),
            },
            Contact {
                id: id("7002"),
                first_name: None,
                last_name: None,
                email: None,
                additional_emails: vec![],
                companies: vec![],
                owner: None,
            },
        ]
    );

    assert_eq!(
        inventory.deals,
        vec![
            Deal {
                id: id("9001"),
                name: Some("Acme renewal".into()),
                pipeline: Some(key("default")),
                stage: Some(key("closedwon")),
                amount: Some(12500.5),
                currency: Some("EUR".into()),
                close_date: Some("2026-03-01T00:00:00Z".into()),
                companies: vec![
                    CompanyLink {
                        company: id("5002"),
                        primary: false
                    },
                    CompanyLink {
                        company: id("5001"),
                        primary: true
                    },
                ],
                owner: Some(id("101")),
            },
            Deal {
                id: id("9002"),
                name: Some("Orphan".into()),
                pipeline: Some(key("75e28846-ad0d-4be2-a027-5e1da6590b98")),
                stage: Some(key("1001")),
                amount: None,
                currency: None,
                close_date: None,
                companies: vec![],
                owner: Some(id("103")),
            },
        ]
    );

    assert_eq!(
        inventory.custom_properties,
        vec![
            CustomProperties {
                object: ObjectType::Company,
                names: vec!["arr_band".into(), "tier".into()],
            },
            CustomProperties {
                object: ObjectType::Deal,
                names: vec!["renewal_date".into()],
            },
        ]
    );

    // The unreadable company and the unparseable amount are reported, not dropped silently.
    assert_eq!(inventory.warnings.len(), 2, "{:?}", inventory.warnings);
    assert!(inventory.warnings.iter().all(|w| !w.contains("Broken")));

    assert_eq!(
        seen.lock().unwrap().last(),
        Some(&ReadProgress {
            companies: 3,
            contacts: 2,
            deals: 2,
        })
    );

    let urls: Vec<String> = fake.api_calls().into_iter().map(|c| c.url).collect();
    assert_eq!(urls.len(), 13);
    assert!(urls[2].contains("after=101"), "{}", urls[2]);
    assert!(urls[3].contains("archived=true"), "{}", urls[3]);
    assert!(urls[5].contains("properties=name"), "{}", urls[5]);
    assert!(urls[7].contains("associations=companies"), "{}", urls[7]);
    assert!(
        urls[8].starts_with(
            "https://api.hubapi.com/crm/v4/objects/contacts/7001/associations/companies"
        ) && !urls[8].contains("after="),
        "{}",
        urls[8]
    );
    assert!(fake.api_calls().iter().all(|c| c.method == Method::GET));
}

#[tokio::test(start_paused = true)]
async fn a_repeated_cursor_fails_instead_of_truncating() {
    let page = r#"{"results": [], "paging": {"next": {"after": "same"}}}"#;
    let (_, service) = connected(vec![
        fixture("account"),
        answer(StatusCode::OK, page),
        answer(StatusCode::OK, page),
    ]);
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(matches!(result, Err(HubspotError::Decode(_))), "{result:?}");
}

#[tokio::test(start_paused = true)]
async fn a_denied_required_read_names_its_scope() {
    let mut responses = full_portal();
    responses.truncate(10);
    responses[9] = answer(
        StatusCode::FORBIDDEN,
        r#"{"status":"error","category":"MISSING_SCOPES","message":"This app hasn't been granted all required scopes"}"#,
    );
    let (_, service) = connected(responses);
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(
        matches!(result, Err(HubspotError::MissingScope(Scope::Deals))),
        "{result:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_refusal_without_missing_scopes_is_not_called_a_scope() {
    let mut responses = full_portal();
    responses.truncate(10);
    responses[9] = answer(
        StatusCode::FORBIDDEN,
        r#"{"status":"error","category":"FORBIDDEN","message":"Portal locked"}"#,
    );
    let (_, service) = connected(responses);
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(
        matches!(result, Err(HubspotError::Upstream { status: 403, .. })),
        "{result:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn denied_property_schemas_only_warn() {
    let mut responses = full_portal();
    for response in &mut responses[10..] {
        *response = answer(StatusCode::FORBIDDEN, "{}");
    }
    let (_, service) = connected(responses);
    let inventory = connections(service)
        .inventory(&user(), &|_| {})
        .await
        .unwrap();
    assert!(inventory.custom_properties.is_empty());
    assert_eq!(
        inventory
            .warnings
            .iter()
            .filter(|w| w.contains("property definitions"))
            .count(),
        3,
        "{:?}",
        inventory.warnings
    );
}

#[tokio::test(start_paused = true)]
async fn an_unauthorized_grant_is_not_connected() {
    let (_, service) = connected(vec![answer(StatusCode::UNAUTHORIZED, "{}")]);
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(
        matches!(result, Err(HubspotError::NotConnected)),
        "{result:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn persistent_rate_limits_are_unavailable() {
    let (fake, service) = connected(
        (0..5)
            .map(|_| {
                answer(
                    StatusCode::TOO_MANY_REQUESTS,
                    r#"{"category":"RATE_LIMITS"}"#,
                )
            })
            .collect(),
    );
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(
        matches!(result, Err(HubspotError::Unavailable)),
        "{result:?}"
    );
    assert_eq!(fake.api_calls().len(), 5);
}

#[tokio::test(start_paused = true)]
async fn no_connection_is_not_connected() {
    let fake = FakeConnectors::new().with_catalog_app(HUBSPOT_APP);
    let service = Arc::new(fake.build());
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(
        matches!(result, Err(HubspotError::NotConnected)),
        "{result:?}"
    );
}

#[test]
fn bodies_never_reach_errors() {
    // Upstream messages are bounded and carry no record content.
    let error = map_error(
        HubspotRead::Objects(ObjectType::Contact),
        TrackerError::Upstream {
            status: 400,
            message: "x".repeat(2000),
        },
    );
    match error {
        HubspotError::Upstream { status, message } => {
            assert_eq!(status, 400);
            assert!(message.chars().count() <= 200);
        }
        other => panic!("{other:?}"),
    }
}

#[tokio::test(start_paused = true)]
async fn whether_hubspot_is_connected_is_known_without_reading_it() {
    let fake = FakeConnectors::new().with_catalog_app(HUBSPOT_APP);
    let unconnected = connections(Arc::new(fake.build()));
    assert!(!unconnected.connected(&user()).await.unwrap());

    let (_, service) = connected(Vec::new());
    assert!(connections(service).connected(&user()).await.unwrap());
}

#[tokio::test(start_paused = true)]
async fn a_page_without_results_fails_instead_of_reading_as_empty() {
    let (_, service) = connected(vec![fixture("account"), answer(StatusCode::OK, "{}")]);
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(matches!(result, Err(HubspotError::Decode(_))), "{result:?}");
}
