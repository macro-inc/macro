use super::*;
use crate::domain::models::LinearStateType;
use crate::outbound::direct_api::DirectApi;
use macro_user_id::cowlike::CowLike;
use pipedream_mcp::domain::models::ProxyMethod;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

const ISSUES: &str = include_str!("fixtures/assigned_open_issues.json");
const RATE_LIMITED: &str = include_str!("fixtures/rate_limited.json");

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|dana@example.com")
        .unwrap()
        .into_owned()
}

/// Replays canned proxy responses and records what was asked.
#[derive(Default)]
struct Replay {
    responses: Mutex<VecDeque<Result<ProxyResponse, ConnectProxyError>>>,
    requests: Mutex<Vec<(String, ProxyRequest)>>,
}

impl Replay {
    fn new(responses: Vec<Result<ProxyResponse, ConnectProxyError>>) -> Arc<Self> {
        Arc::new(Self {
            responses: Mutex::new(responses.into()),
            requests: Mutex::default(),
        })
    }
}

fn ok(body: &str) -> Result<ProxyResponse, ConnectProxyError> {
    Ok(ProxyResponse {
        status: 200,
        retry_after: None,
        body: body.as_bytes().to_vec(),
    })
}

impl ConnectProxy for Replay {
    async fn send(
        &self,
        caller: &MacroUserIdStr<'static>,
        app_slug: &str,
        request: ProxyRequest,
    ) -> Result<ProxyResponse, ConnectProxyError> {
        assert_eq!(caller, &user());
        self.requests
            .lock()
            .unwrap()
            .push((app_slug.to_string(), request));
        self.responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected proxy call")
    }
}

#[tokio::test]
async fn reads_the_viewers_assigned_issues_through_the_linear_connection() {
    let proxy = Replay::new(vec![ok(ISSUES)]);
    let source = LinearApiSource::new(proxy.clone());

    let issues = source.assigned_open_issues(&user(), 50).await.unwrap();

    assert_eq!(issues.len(), 7);
    let first = &issues[0];
    assert_eq!(first.identifier, "ENG-142");
    assert_eq!(first.state.kind, LinearStateType::Started);
    assert_eq!(first.priority, 1);
    assert_eq!(
        first.due_date,
        Some(chrono::NaiveDate::from_ymd_opt(2026, 10, 10).unwrap())
    );
    assert!(first.description.as_deref().unwrap().len() > 4_000);
    assert!(issues.iter().any(|issue| issue.archived));
    assert_eq!(issues[3].description, None);

    let requests = proxy.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    let (slug, request) = &requests[0];
    assert_eq!(slug, "linear");
    assert_eq!(request.method, ProxyMethod::Post);
    assert_eq!(request.url, "https://api.linear.app/graphql");
    let body = request.body.as_ref().unwrap();
    assert_eq!(body["variables"]["first"], 100);
    let query = body["query"].as_str().unwrap();
    assert!(query.contains("assignedIssues"));
    assert!(query.contains(r#"nin: ["completed", "canceled"]"#));
}

#[tokio::test]
async fn follows_pagination_up_to_the_page_cap() {
    let mut page: serde_json::Value = serde_json::from_str(ISSUES).unwrap();
    page["data"]["viewer"]["assignedIssues"]["pageInfo"]["hasNextPage"] = true.into();
    let page = page.to_string();
    let proxy = Replay::new(vec![ok(&page), ok(&page), ok(&page)]);
    let source = LinearApiSource::new(proxy.clone());

    let issues = source.assigned_open_issues(&user(), 50).await.unwrap();

    assert_eq!(issues.len(), 21);
    let requests = proxy.requests.lock().unwrap();
    assert_eq!(requests.len(), MAX_PAGES);
    assert_eq!(
        requests[1].1.body.as_ref().unwrap()["variables"]["after"],
        "cursor-1"
    );
}

#[tokio::test]
async fn rate_limits_report_retry_after() {
    let proxy = Replay::new(vec![
        Ok(ProxyResponse {
            status: 429,
            retry_after: Some(Duration::from_secs(3)),
            body: Vec::new(),
        }),
        Ok(ProxyResponse {
            status: 400,
            retry_after: None,
            body: RATE_LIMITED.as_bytes().to_vec(),
        }),
    ]);
    let source = LinearApiSource::new(proxy);

    assert!(matches!(
        source.assigned_open_issues(&user(), 50).await.unwrap_err(),
        ApiSourceError::RateLimited {
            app: ImportSource::Linear,
            retry_after: Some(delay),
        } if delay == Duration::from_secs(3)
    ));
    // Linear also reports throttling as a GraphQL error.
    assert!(matches!(
        source.assigned_open_issues(&user(), 50).await.unwrap_err(),
        ApiSourceError::RateLimited {
            app: ImportSource::Linear,
            retry_after: None,
        }
    ));
}

#[tokio::test]
async fn missing_pipedream_connection_is_not_connected() {
    let proxy = Replay::new(vec![Err(ConnectProxyError::NotConnected {
        app_slug: "linear".into(),
    })]);
    let error = LinearApiSource::new(proxy)
        .assigned_open_issues(&user(), 50)
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        ApiSourceError::NotConnected(ImportSource::Linear)
    ));
}

#[tokio::test]
async fn refused_credentials_and_graphql_errors_are_reported() {
    let proxy = Replay::new(vec![Ok(ProxyResponse {
        status: 401,
        retry_after: None,
        body: Vec::new(),
    })]);
    assert!(matches!(
        LinearApiSource::new(proxy)
            .assigned_open_issues(&user(), 50)
            .await
            .unwrap_err(),
        ApiSourceError::Unauthorized(ImportSource::Linear)
    ));

    let proxy = Replay::new(vec![Ok(ProxyResponse {
        status: 400,
        retry_after: None,
        body: br#"{"errors":[{"message":"Cannot query field \"bogus\""}]}"#.to_vec(),
    })]);
    let error = LinearApiSource::new(proxy)
        .assigned_open_issues(&user(), 50)
        .await
        .unwrap_err();
    assert!(error.to_string().contains("Cannot query field"));
}

/// The tasks discovery would create from `issues`, one table row each, for
/// the live preview.
fn task_rows(
    issues: Vec<crate::domain::models::LinearIssue>,
    user: &MacroUserIdStr<'static>,
) -> Vec<String> {
    use crate::domain::service::{
        MAX_LINEAR_ISSUES, linear_issue_meta, linear_task_content, linear_task_properties,
        select_linear_issues,
    };
    select_linear_issues(issues, MAX_LINEAR_ISSUES)
        .iter()
        .map(|issue| {
            let meta = linear_issue_meta(issue);
            let (name, body) = linear_task_content(&meta);
            let properties = linear_task_properties(&meta, user);
            format!(
                "| {} | {} | {} | {} | {} | {} | {} chars |",
                issue.identifier,
                name,
                properties.status.as_deref().unwrap_or("—"),
                properties.priority.as_deref().unwrap_or("—"),
                properties.due_date.as_deref().unwrap_or("—"),
                properties.assignee_email.as_deref().unwrap_or("—"),
                body.len(),
            )
        })
        .collect()
}

macro_env_var::env_var! {
    /// A Linear personal API key for the live preview.
    struct LiveLinearVars {
        LinearApiKey,
    }
}

/// Preview discovery and task mapping against a real Linear workspace,
/// reading Linear's API directly instead of through Pipedream:
/// `LINEAR_API_KEY=… cargo test -p import live_linear_preview -- --ignored --nocapture`.
#[tokio::test]
#[ignore = "reads a real Linear workspace; requires LINEAR_API_KEY"]
async fn live_linear_preview() {
    let key = LiveLinearVars::new()
        .expect("set LINEAR_API_KEY to a Linear personal API key")
        .linear_api_key
        .as_ref()
        .to_string();
    let issues = LinearApiSource::new(Arc::new(DirectApi::new(key)))
        .assigned_open_issues(&user(), crate::domain::service::MAX_LINEAR_ISSUES)
        .await
        .unwrap();
    println!("| Issue | Task | Status | Priority | Due | Assignee | Body |");
    println!("|---|---|---|---|---|---|---|");
    for row in task_rows(issues, &user()) {
        println!("{row}");
    }
}
