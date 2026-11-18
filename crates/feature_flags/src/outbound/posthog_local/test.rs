use super::*;
use serde_json::json;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header as has_header, method, path, query_param},
};

const PROJECT_KEY: &str = "test-project-key";
const SECRET_KEY: &str = "test-secret-key";
const FLAG: &str = "enable-rollout";
const TIMEOUT: Duration = Duration::from_secs(2);

/// posthog-python's `test_simple_flag_consistency`: whether
/// `distinct_id_<i>` is in a 45% rollout of `simple-flag`, for i in 0..1000.
const SIMPLE_FLAG_45_PERCENT: &str = include_str!("simple-flag-45-percent.txt");

fn loader(server: &MockServer, environment: Environment) -> PostHogLocalFeatureFlags {
    PostHogLocalFeatureFlags::new(
        &server.uri(),
        PROJECT_KEY,
        SECRET_KEY.to_owned(),
        &[FLAG],
        TIMEOUT,
        environment,
    )
    .unwrap()
}

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn person(property: &str, operator: &str, value: Value) -> Value {
    json!({"key": property, "type": "person", "operator": operator, "value": value})
}

fn flag(groups: Value) -> Value {
    json!({
        "id": 1, "key": FLAG, "name": "Rollout", "active": true, "deleted": false,
        "ensure_experience_continuity": false,
        "filters": {"groups": groups, "multivariate": null, "payloads": {}},
    })
}

/// The shape of a staged rollout: a domain at 100%, one named person, and a
/// percentage of everyone, each limited to one environment.
fn rollout(percentage: u8) -> Value {
    let prod = person("environment", "exact", json!(["prod"]));
    flag(json!([
        {"properties": [person("email", "icontains", json!("@staff.example")), prod], "rollout_percentage": 100},
        {"properties": [person("email", "exact", json!(["Guest@Partner.example"])), prod], "rollout_percentage": null},
        {"properties": [prod], "rollout_percentage": percentage},
    ]))
}

fn definitions(flags: Value) -> ResponseTemplate {
    ResponseTemplate::new(200)
        .insert_header("ETag", "\"v1\"")
        .set_body_json(json!({"flags": flags, "group_type_mapping": {}, "cohorts": {}}))
}

async fn serving(flags: Value) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/flags/definitions"))
        .and(query_param("token", PROJECT_KEY))
        .and(has_header("authorization", format!("Bearer {SECRET_KEY}")))
        .respond_with(definitions(flags))
        .mount(&server)
        .await;
    server
}

async fn enabled(flags: &PostHogLocalFeatureFlags, email: &str) -> Result<Option<bool>, Report> {
    let snapshot = flags.load(&user(email)).await?;
    Ok(snapshot
        .get(FLAG)
        .map(|value| value == &FlagValue::Boolean(true)))
}

/// Let `duration` pass on the runtime's clock, between requests.
async fn pass(duration: Duration) {
    tokio::time::pause();
    tokio::time::advance(duration).await;
    tokio::time::resume();
}

#[test]
fn buckets_the_way_posthog_does() {
    let flag = FlagDefinition {
        key: "simple-flag".to_owned(),
        active: true,
        deleted: false,
        ensure_experience_continuity: None,
        bucketing_identifier: None,
        filters: serde_json::from_value(
            json!({"groups": [{"properties": [], "rollout_percentage": 45}]}),
        )
        .unwrap(),
    };
    assert_eq!(SIMPLE_FLAG_45_PERCENT.trim().len(), 1000);
    for (i, expected) in SIMPLE_FLAG_45_PERCENT.trim().chars().enumerate() {
        let distinct_id = format!("distinct_id_{i}");
        let person = Person {
            distinct_id: &distinct_id,
            properties: [
                ("distinct_id", distinct_id.as_str()),
                ("email", ""),
                ("environment", ""),
            ],
        };
        assert_eq!(
            flag.evaluate(&person),
            Ok(Some(expected == '1')),
            "distinct_id_{i}"
        );
    }
}

#[tokio::test]
async fn evaluates_a_staged_rollout_by_email_person_and_environment() {
    let server = serving(json!([rollout(0)])).await;
    let flags = loader(&server, Environment::Production);

    assert_eq!(
        enabled(&flags, "ada@staff.example").await.unwrap(),
        Some(true)
    );
    assert_eq!(
        enabled(&flags, "ADA@Staff.Example").await.unwrap(),
        Some(true)
    );
    assert_eq!(
        enabled(&flags, "guest@partner.example").await.unwrap(),
        Some(true)
    );
    assert_eq!(
        enabled(&flags, "bo@elsewhere.example").await.unwrap(),
        Some(false)
    );

    let dev = loader(&server, Environment::Develop);
    assert_eq!(
        enabled(&dev, "ada@staff.example").await.unwrap(),
        Some(false)
    );

    // At 100%, everyone in prod.
    let everyone = serving(json!([rollout(100)])).await;
    let flags = loader(&everyone, Environment::Production);
    assert_eq!(
        enabled(&flags, "bo@elsewhere.example").await.unwrap(),
        Some(true)
    );
}

#[tokio::test]
async fn polls_once_per_interval_and_keeps_unchanged_definitions() {
    let server = MockServer::start().await;
    Mock::given(has_header("if-none-match", "\"v1\""))
        .respond_with(ResponseTemplate::new(304))
        .expect(1)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .respond_with(definitions(json!([rollout(0)])))
        .expect(1)
        .mount(&server)
        .await;
    let flags = loader(&server, Environment::Production);

    assert_eq!(
        enabled(&flags, "ada@staff.example").await.unwrap(),
        Some(true)
    );
    assert_eq!(
        enabled(&flags, "bo@elsewhere.example").await.unwrap(),
        Some(false)
    );
    pass(POLL_INTERVAL).await;
    // Unchanged: the 304 renews the definitions held.
    assert_eq!(
        enabled(&flags, "ada@staff.example").await.unwrap(),
        Some(true)
    );
    pass(MAX_STALENESS - Duration::from_secs(60)).await;
    server.verify().await;
    server.reset().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(503))
        .mount(&server)
        .await;
    assert_eq!(
        enabled(&flags, "ada@staff.example").await.unwrap(),
        Some(true)
    );
}

#[tokio::test]
async fn fails_without_definitions_or_once_they_are_an_hour_old() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(401))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .respond_with(definitions(json!([rollout(0)])))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    let flags = loader(&server, Environment::Production);

    assert!(enabled(&flags, "ada@staff.example").await.is_err());
    // A failed poll is retried after 30 seconds, not on every load.
    assert!(enabled(&flags, "ada@staff.example").await.is_err());
    pass(RETRY_INTERVAL).await;
    assert_eq!(
        enabled(&flags, "ada@staff.example").await.unwrap(),
        Some(true)
    );

    pass(MAX_STALENESS).await;
    let error = enabled(&flags, "ada@staff.example").await.unwrap_err();
    assert!(format!("{error}").contains("No PostHog flag definitions"));
}

#[tokio::test]
async fn a_condition_it_cannot_evaluate_fails_the_flag_unless_another_matches() {
    let cohort = json!({"key": "id", "type": "cohort", "value": 7});
    let server = serving(json!([flag(json!([
        {"properties": [person("email", "icontains", json!("@staff.example"))], "rollout_percentage": 100},
        {"properties": [cohort], "rollout_percentage": 100},
    ]))]))
    .await;
    let flags = loader(&server, Environment::Production);

    assert_eq!(
        enabled(&flags, "ada@staff.example").await.unwrap(),
        Some(true)
    );
    let error = enabled(&flags, "bo@elsewhere.example").await.unwrap_err();
    assert!(format!("{error}").contains("can't be evaluated locally"));
}

#[tokio::test]
async fn a_property_the_service_does_not_send_fails_the_flag() {
    let server = serving(json!([flag(json!([
        {"properties": [person("plan", "exact", json!(["team"]))], "rollout_percentage": 100},
    ]))]))
    .await;
    let flags = loader(&server, Environment::Production);

    assert!(enabled(&flags, "ada@staff.example").await.is_err());
}

#[tokio::test]
async fn one_failing_property_decides_a_condition_it_cannot_otherwise_evaluate() {
    let server = serving(json!([flag(json!([
        {"properties": [person("plan", "exact", json!(["team"])), person("environment", "exact", json!(["dev"]))]},
    ]))]))
    .await;
    let flags = loader(&server, Environment::Production);

    assert_eq!(
        enabled(&flags, "ada@staff.example").await.unwrap(),
        Some(false)
    );
}

#[tokio::test]
async fn definitions_it_does_not_support_fail_the_flag() {
    let unsupported = [
        json!({"ensure_experience_continuity": true}),
        json!({"filters": {"groups": [{"rollout_percentage": 100}], "multivariate": {"variants": []}}}),
        json!({"filters": {"groups": [{"rollout_percentage": 100}], "aggregation_group_type_index": 0}}),
        json!({"filters": {"groups": [{"rollout_percentage": 100}], "holdout": {"id": 1, "exclusion_percentage": 10}}}),
        json!({"bucketing_identifier": "device_id"}),
        json!({"filters": {"groups": [{"properties": [person("email", "regex", json!(".*"))]}]}}),
        json!({"filters": {"groups": [{"properties": [person("environment", "exact", json!(true))]}]}}),
        json!({"active": "yes"}),
    ];
    for overrides in unsupported {
        let mut definition = flag(json!([{"rollout_percentage": 100}]));
        for (field, value) in overrides.as_object().unwrap() {
            definition[field] = value.clone();
        }
        let server = serving(json!([definition])).await;
        let flags = loader(&server, Environment::Production);
        assert!(
            enabled(&flags, "ada@staff.example").await.is_err(),
            "{overrides}"
        );
    }
}

#[tokio::test]
async fn inactive_deleted_and_absent_flags_read_off() {
    let mut inactive = rollout(100);
    inactive["active"] = json!(false);
    let server = serving(json!([inactive])).await;
    assert_eq!(
        enabled(
            &loader(&server, Environment::Production),
            "ada@staff.example"
        )
        .await
        .unwrap(),
        Some(false)
    );

    let mut deleted = rollout(100);
    deleted["deleted"] = json!(true);
    for flags in [json!([deleted]), json!([])] {
        let server = serving(flags).await;
        let flags = loader(&server, Environment::Production);
        let snapshot = flags.load(&user("ada@staff.example")).await.unwrap();
        assert_eq!(snapshot.get(FLAG), None);
        assert!(!snapshot.is_enabled(FLAG));
    }
}

#[tokio::test]
async fn other_flags_are_neither_read_nor_returned() {
    let server = serving(json!([
        rollout(100),
        {"key": "someone-elses", "active": true, "filters": {"multivariate": {"variants": []}}},
        {"key": "unreadable", "active": "maybe"},
    ]))
    .await;
    let flags = loader(&server, Environment::Production);

    let snapshot = flags.load(&user("ada@staff.example")).await.unwrap();
    assert!(snapshot.is_enabled(FLAG));
    assert_eq!(snapshot.get("someone-elses"), None);
}

#[test]
fn rejects_bad_configuration() {
    let new = |host: &str, project: &str, secret: &str, keys: &[&str], timeout| {
        PostHogLocalFeatureFlags::new(
            host,
            project,
            secret.to_owned(),
            keys,
            timeout,
            Environment::Local,
        )
        .is_err()
    };
    let host = "https://us.i.posthog.com";
    assert!(new(
        "https://us.i.posthog.com/api",
        "p",
        "s",
        &[FLAG],
        TIMEOUT
    ));
    assert!(new(host, " ", "s", &[FLAG], TIMEOUT));
    assert!(new(host, "p", "", &[FLAG], TIMEOUT));
    assert!(new(host, "p", "s", &[], TIMEOUT));
    assert!(new(host, "p", "s", &[FLAG], Duration::ZERO));
    assert!(!new(host, "p", "s", &[FLAG], TIMEOUT));
}

#[tokio::test]
async fn a_set_field_it_does_not_know_fails_the_flag() {
    let mut early_exit = rollout(100);
    early_exit["filters"]["early_exit"] = json!(true);
    let server = serving(json!([early_exit])).await;
    let error = enabled(
        &loader(&server, Environment::Production),
        "ada@staff.example",
    )
    .await
    .unwrap_err();
    assert!(format!("{error}").contains("early_exit"));

    // Unset or known-harmless fields don't.
    let mut harmless = rollout(100);
    harmless["filters"]["early_exit"] = json!(false);
    harmless["filters"]["groups"][0]["description"] = json!("Staff");
    let server = serving(json!([harmless])).await;
    assert_eq!(
        enabled(
            &loader(&server, Environment::Production),
            "ada@staff.example"
        )
        .await
        .unwrap(),
        Some(true)
    );
}

#[tokio::test]
async fn a_rejected_key_drops_the_definitions_at_once() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .respond_with(definitions(json!([rollout(0)])))
        .up_to_n_times(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .respond_with(ResponseTemplate::new(401))
        .mount(&server)
        .await;
    let flags = loader(&server, Environment::Production);

    assert_eq!(
        enabled(&flags, "ada@staff.example").await.unwrap(),
        Some(true)
    );
    pass(POLL_INTERVAL).await;
    assert!(enabled(&flags, "ada@staff.example").await.is_err());
}

#[tokio::test]
async fn compares_with_every_supported_operator() {
    let cases = [
        (person("email", "exact", json!("ada@staff.example")), true),
        (
            person("email", "is_not", json!(["ada@staff.example"])),
            false,
        ),
        (person("email", "is_not", json!(["bo@staff.example"])), true),
        (person("email", "not_icontains", json!("@STAFF")), false),
        (person("email", "not_icontains", json!("@partner")), true),
        (person("email", "is_set", json!(null)), true),
        (person("email", "is_not_set", json!(null)), false),
    ];
    for (filter, expected) in cases {
        let server = serving(json!([flag(json!([{"properties": [filter]}]))])).await;
        let flags = loader(&server, Environment::Production);
        assert_eq!(
            enabled(&flags, "ada@staff.example").await.unwrap(),
            Some(expected),
            "{filter}"
        );
    }
}

#[tokio::test]
async fn buckets_by_the_macro_user_id() {
    let server = serving(json!([flag(json!([{"rollout_percentage": 50}]))])).await;
    let flags = loader(&server, Environment::Production);
    let mut inside = 0;
    for i in 0..200 {
        let email = format!("user{i}@elsewhere.example");
        let expected = bucket(FLAG, &format!("macro|{email}")) <= 0.5;
        let actual = enabled(&flags, &email).await.unwrap();
        assert_eq!(actual, Some(expected), "{email}");
        inside += usize::from(expected);
    }
    assert!(
        (70..130).contains(&inside),
        "{inside} of 200 in a 50% rollout"
    );
}
