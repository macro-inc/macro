use super::*;
use crate::domain::{Account, Contact, Opportunity, Org, Owner, RecordId, Stage};
use connectors::fake::{FakeConnection, FakeConnectors};
use connectors::{ApiResponse, Connectors};
use http::{HeaderMap, StatusCode};
use std::sync::Mutex;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").unwrap()
}

fn fixture(name: &str) -> ApiResponse {
    let body = match name {
        "userinfo" => include_str!("fixtures/userinfo.json"),
        "organization" => include_str!("fixtures/organization.json"),
        "users" => include_str!("fixtures/users.json"),
        "stages" => include_str!("fixtures/stages.json"),
        "accounts_page1" => include_str!("fixtures/accounts_page1.json"),
        "accounts_page2" => include_str!("fixtures/accounts_page2.json"),
        "contacts" => include_str!("fixtures/contacts.json"),
        "opportunities" => include_str!("fixtures/opportunities.json"),
        "opportunities_single_currency" => {
            include_str!("fixtures/opportunities_single_currency.json")
        }
        "invalid_field" => include_str!("fixtures/invalid_field.json"),
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
        .with_catalog_app(SALESFORCE_APP)
        .with_connection(
            &user(),
            FakeConnection::app(SALESFORCE_APP).answering_in_turn(responses),
        );
    let service = Arc::new(fake.build());
    (fake, service)
}

fn connections(service: Arc<Connectors>) -> SalesforceApi<Connectors> {
    SalesforceApi::with_interval(service, Duration::ZERO)
}

/// Every fixture, in the order a full read asks for them.
fn full_org() -> Vec<ApiResponse> {
    [
        "userinfo",
        "organization",
        "users",
        "stages",
        "accounts_page1",
        "accounts_page2",
        "contacts",
        "opportunities",
    ]
    .into_iter()
    .map(fixture)
    .collect()
}

fn id(value: &str) -> RecordId {
    RecordId::try_from(value.to_owned()).unwrap()
}

#[test]
fn every_read_is_a_fixed_relative_get() {
    let reads = [
        SalesforceRead::UserInfo,
        SalesforceRead::Query(Query::OrgCurrency),
        SalesforceRead::Query(Query::Users),
        SalesforceRead::Query(Query::Stages),
        SalesforceRead::Query(Query::Accounts),
        SalesforceRead::Query(Query::Contacts),
        SalesforceRead::Query(Query::Opportunities { currency: true }),
        SalesforceRead::Query(Query::Opportunities { currency: false }),
        SalesforceRead::QueryMore(
            QueryLocator::parse("/services/data/v62.0/query/01g5g00000ExAmPAAT-2000").unwrap(),
        ),
    ];
    for read in reads {
        let url = read.url();
        assert!(url.starts_with("/services/"), "{url}");
        assert!(!url.contains("://") && !url.contains(' '), "{url}");
        assert_eq!(read.method(), Method::GET);
    }
    assert_eq!(
        SalesforceRead::Query(Query::Accounts).url(),
        "/services/data/v62.0/query?q=SELECT+Id%2C+Name%2C+Website%2C+OwnerId+FROM+Account+ORDER+BY+Id"
    );
}

#[test]
fn only_this_versions_query_locators_are_followed() {
    for bad in [
        "https://evil.example.com/services/data/v62.0/query/01g5g00000ExAmPAAT-2000",
        "/services/data/v61.0/query/01g5g00000ExAmPAAT-2000",
        "/services/data/v62.0/query/../sobjects/User",
        "/services/data/v62.0/query/01g5g00000ExAmPAAT-2000?q=x",
        "/services/data/v62.0/query/",
    ] {
        assert!(QueryLocator::parse(bad).is_err(), "{bad}");
    }
}

#[tokio::test(start_paused = true)]
async fn reads_a_whole_org() {
    let (fake, service) = connected(full_org());
    let seen = Mutex::new(Vec::new());
    let inventory = connections(service)
        .inventory(&user(), &|progress| seen.lock().unwrap().push(progress))
        .await
        .unwrap();

    assert_eq!(
        inventory.org,
        Org {
            id: id("00D5g000004ExAmEAC"),
            instance_url: Some("https://acme-dev-ed.my.salesforce.com".into()),
            currency: Some("USD".into()),
        }
    );
    assert_eq!(
        inventory.owners,
        vec![
            Owner {
                id: id("0055g00000ExAmPAA1"),
                email: Some("importer@example.com".into()),
                active: true,
            },
            Owner {
                id: id("0055g00000ExAmQAA1"),
                email: Some("seller@example.org".into()),
                active: true,
            },
            Owner {
                id: id("0055g00000ExAmRAA1"),
                email: Some("former@example.net".into()),
                active: false,
            },
        ]
    );
    assert_eq!(
        inventory.stages,
        vec![
            Stage {
                api_name: "Prospecting".into(),
                label: "Prospecting".into(),
                sort_order: 1,
                closed: false,
                won: false,
                probability: Some(0.1),
            },
            Stage {
                api_name: "Closed_Won".into(),
                label: "Closed Won".into(),
                sort_order: 9,
                closed: true,
                won: true,
                probability: Some(1.0),
            },
            Stage {
                api_name: "Closed Lost".into(),
                label: "Closed Lost".into(),
                sort_order: 10,
                closed: true,
                won: false,
                probability: None,
            },
        ]
    );
    assert_eq!(
        inventory.accounts,
        vec![
            Account {
                id: id("0015g00000AcmeAAA1"),
                name: Some("Acme".into()),
                website: Some("https://acme.example".into()),
                owner: Some(id("0055g00000ExAmQAA1")),
            },
            Account {
                id: id("0015g00000GlobAAA1"),
                name: None,
                website: None,
                owner: Some(id("0055g00000ExAmRAA1")),
            },
        ]
    );
    assert_eq!(
        inventory.contacts,
        vec![
            Contact {
                id: id("0035g00000ConAAAA1"),
                first_name: Some("Pat".into()),
                last_name: Some("Example".into()),
                email: Some("pat@acme.example".into()),
                account: Some(id("0015g00000AcmeAAA1")),
                owner: Some(id("0055g00000ExAmQAA1")),
            },
            Contact {
                id: id("0035g00000ConBAAA1"),
                first_name: None,
                last_name: Some("Sample".into()),
                email: None,
                account: None,
                owner: Some(id("0055g00000ExAmPAA1")),
            },
        ]
    );
    assert_eq!(
        inventory.opportunities,
        vec![
            Opportunity {
                id: id("0065g00000OppAAAA1"),
                name: Some("Acme renewal".into()),
                stage: Some("Closed_Won".into()),
                amount: Some(12500.5),
                currency: Some("EUR".into()),
                close_date: Some("2026-03-01".into()),
                account: Some(id("0015g00000AcmeAAA1")),
                owner: Some(id("0055g00000ExAmQAA1")),
                closed: true,
                won: true,
            },
            Opportunity {
                id: id("0065g00000OppBAAA1"),
                name: Some("Open deal".into()),
                stage: Some("Prospecting".into()),
                amount: None,
                currency: Some("USD".into()),
                close_date: None,
                account: None,
                owner: Some(id("0055g00000ExAmRAA1")),
                closed: false,
                won: false,
            },
        ]
    );

    // The account with a malformed id is reported, without its name.
    assert_eq!(inventory.warnings.len(), 1, "{:?}", inventory.warnings);
    assert!(!inventory.warnings[0].contains("Broken"));

    assert_eq!(
        *seen.lock().unwrap(),
        vec![
            ReadProgress {
                accounts: 2,
                contacts: 0,
                opportunities: 0,
            },
            ReadProgress {
                accounts: 2,
                contacts: 0,
                opportunities: 0,
            },
            ReadProgress {
                accounts: 2,
                contacts: 2,
                opportunities: 0,
            },
            ReadProgress {
                accounts: 2,
                contacts: 2,
                opportunities: 2,
            },
        ]
    );

    let calls = fake.api_calls();
    assert!(calls.iter().all(|call| call.method == Method::GET));
    let urls: Vec<String> = calls.into_iter().map(|call| call.url).collect();
    assert_eq!(
        urls,
        vec![
            SalesforceRead::UserInfo.url(),
            SalesforceRead::Query(Query::OrgCurrency).url(),
            SalesforceRead::Query(Query::Users).url(),
            SalesforceRead::Query(Query::Stages).url(),
            SalesforceRead::Query(Query::Accounts).url(),
            "/services/data/v62.0/query/01g5g00000ExAmPAAT-2000".to_owned(),
            SalesforceRead::Query(Query::Contacts).url(),
            SalesforceRead::Query(Query::Opportunities { currency: true }).url(),
        ]
    );
    assert_eq!(urls[0], "/services/oauth2/userinfo");
    assert!(urls[7].contains("CurrencyIsoCode"), "{}", urls[7]);
}

#[tokio::test(start_paused = true)]
async fn the_instance_origin_falls_back_to_the_rest_url() {
    let mut responses = full_org();
    responses[0] = answer(
        StatusCode::OK,
        r#"{"organization_id": "00D5g000004ExAmEAC", "urls": {"rest": "https://acme.my.salesforce.com/services/data/v{version}/", "profile": "https://other.example.com/0055g00000ExAmPAA1"}}"#,
    );
    let (_, service) = connected(responses);
    let inventory = connections(service)
        .inventory(&user(), &|_| {})
        .await
        .unwrap();
    assert_eq!(
        inventory.org.instance_url.as_deref(),
        Some("https://acme.my.salesforce.com")
    );
}

#[tokio::test(start_paused = true)]
async fn an_org_without_an_origin_still_reads() {
    let mut responses = full_org();
    responses[0] = answer(
        StatusCode::OK,
        r#"{"organization_id": "00D5g000004ExAmEAC"}"#,
    );
    let (_, service) = connected(responses);
    let inventory = connections(service)
        .inventory(&user(), &|_| {})
        .await
        .unwrap();
    assert_eq!(inventory.org.instance_url, None);
    assert_eq!(inventory.opportunities.len(), 2);
}

#[tokio::test(start_paused = true)]
async fn a_single_currency_org_reads_opportunities_without_currency() {
    let mut responses = full_org();
    responses.truncate(7);
    responses.push(answer(
        StatusCode::BAD_REQUEST,
        include_str!("fixtures/invalid_field.json"),
    ));
    responses.push(fixture("opportunities_single_currency"));
    let (fake, service) = connected(responses);
    let inventory = connections(service)
        .inventory(&user(), &|_| {})
        .await
        .unwrap();
    assert_eq!(
        inventory.opportunities,
        vec![Opportunity {
            id: id("0065g00000OppAAAA1"),
            name: Some("Acme renewal".into()),
            stage: Some("Closed_Won".into()),
            amount: Some(12500.5),
            currency: None,
            close_date: Some("2026-03-01".into()),
            account: Some(id("0015g00000AcmeAAA1")),
            owner: Some(id("0055g00000ExAmQAA1")),
            closed: true,
            won: true,
        }]
    );
    let urls: Vec<String> = fake.api_calls().into_iter().map(|call| call.url).collect();
    assert_eq!(urls.len(), 9);
    assert!(urls[7].contains("CurrencyIsoCode"), "{}", urls[7]);
    assert_eq!(
        urls[8],
        SalesforceRead::Query(Query::Opportunities { currency: false }).url()
    );
    assert!(!urls[8].contains("CurrencyIsoCode"), "{}", urls[8]);
}

#[tokio::test(start_paused = true)]
async fn another_bad_request_is_not_retried_without_currency() {
    let mut responses = full_org();
    responses.truncate(7);
    responses.push(answer(
        StatusCode::BAD_REQUEST,
        r#"[{"message": "Pat Example broke it", "errorCode": "MALFORMED_QUERY"}]"#,
    ));
    let (fake, service) = connected(responses);
    let error = connections(service)
        .inventory(&user(), &|_| {})
        .await
        .unwrap_err();
    assert!(
        matches!(error, SalesforceError::Upstream { status: 400, .. }),
        "{error:?}"
    );
    assert!(!format!("{error} {error:?}").contains("Pat"), "{error:?}");
    assert_eq!(fake.api_calls().len(), 8);
}

#[tokio::test(start_paused = true)]
async fn a_repeated_page_locator_fails_instead_of_truncating() {
    let page = r#"{"totalSize": 4000, "done": false, "nextRecordsUrl": "/services/data/v62.0/query/01g5g00000ExAmPAAT-2000", "records": []}"#;
    let mut responses = full_org();
    responses.truncate(4);
    responses.push(answer(StatusCode::OK, page));
    responses.push(answer(StatusCode::OK, page));
    let (_, service) = connected(responses);
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(
        matches!(result, Err(SalesforceError::Decode(_))),
        "{result:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_page_without_records_fails_instead_of_reading_as_empty() {
    let mut responses = full_org();
    responses.truncate(4);
    responses.push(answer(StatusCode::OK, r#"{"totalSize": 0, "done": true}"#));
    let (_, service) = connected(responses);
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(
        matches!(result, Err(SalesforceError::Decode(_))),
        "{result:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn an_unauthorized_grant_is_not_connected() {
    let (_, service) = connected(vec![answer(
        StatusCode::UNAUTHORIZED,
        r#"[{"message": "Session expired or invalid", "errorCode": "INVALID_SESSION_ID"}]"#,
    )]);
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(
        matches!(result, Err(SalesforceError::NotConnected)),
        "{result:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn a_refused_read_keeps_no_provider_text() {
    let mut responses = full_org();
    responses.truncate(2);
    responses.push(answer(
        StatusCode::FORBIDDEN,
        r#"[{"message": "Pat Example may not read users", "errorCode": "INSUFFICIENT_ACCESS"}]"#,
    ));
    let (_, service) = connected(responses);
    let error = connections(service)
        .inventory(&user(), &|_| {})
        .await
        .unwrap_err();
    match &error {
        SalesforceError::Upstream { status, message } => {
            assert_eq!(*status, 403);
            assert_eq!(message, "Salesforce refused this read.");
        }
        other => panic!("{other:?}"),
    }
    assert!(!format!("{error} {error:?}").contains("Pat"), "{error:?}");
}

#[tokio::test(start_paused = true)]
async fn persistent_rate_limits_are_unavailable() {
    let (fake, service) = connected(
        (0..5)
            .map(|_| {
                answer(
                    StatusCode::TOO_MANY_REQUESTS,
                    r#"[{"message": "busy", "errorCode": "REQUEST_LIMIT_EXCEEDED"}]"#,
                )
            })
            .collect(),
    );
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(
        matches!(result, Err(SalesforceError::Unavailable)),
        "{result:?}"
    );
    assert_eq!(fake.api_calls().len(), 5);
}

#[tokio::test(start_paused = true)]
async fn no_connection_is_not_connected() {
    let fake = FakeConnectors::new().with_catalog_app(SALESFORCE_APP);
    let service = Arc::new(fake.build());
    let result = connections(service).inventory(&user(), &|_| {}).await;
    assert!(
        matches!(result, Err(SalesforceError::NotConnected)),
        "{result:?}"
    );
}

#[tokio::test(start_paused = true)]
async fn whether_salesforce_is_connected_is_known_without_reading_it() {
    let fake = FakeConnectors::new().with_catalog_app(SALESFORCE_APP);
    let unconnected = connections(Arc::new(fake.build()));
    assert!(!unconnected.connected(&user()).await.unwrap());

    let (fake, service) = connected(Vec::new());
    assert!(connections(service).connected(&user()).await.unwrap());
    assert!(fake.api_calls().is_empty());
}
