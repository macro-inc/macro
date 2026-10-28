use super::*;
use async_trait::async_trait;
use cognition::domain::{DecisionResponse, GenerateObjectRequest, GenerateObjectResponse};
use rootcause::Report;
use std::sync::Mutex;

struct Classifier {
    requests: Mutex<Vec<DecisionRequest>>,
    delay: Duration,
    fail: bool,
    relevant: &'static [&'static str],
}
#[async_trait]
impl Cognition for Classifier {
    async fn generate_object(
        &self,
        _: &MacroUserIdStr<'static>,
        _: GenerateObjectRequest,
    ) -> Result<GenerateObjectResponse, Report> {
        panic!("selection must not generate text")
    }
    async fn decide(
        &self,
        _: &MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, Report> {
        let probabilities = request
            .questions
            .keys()
            .map(|name| {
                (
                    name.clone(),
                    if self.relevant.is_empty() || self.relevant.contains(&name.as_str()) {
                        0.9
                    } else {
                        0.1
                    },
                )
            })
            .collect();
        self.requests.lock().unwrap().push(request);
        tokio::time::sleep(self.delay).await;
        if self.fail {
            return Err(rootcause::report!("unavailable"));
        }
        Ok(DecisionResponse { probabilities })
    }
}
fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|fixture@example.com").unwrap()
}
#[tokio::test]
async fn one_bounded_request_expands_only_selected_entities() {
    let classifier = Arc::new(Classifier {
        requests: Mutex::new(vec![]),
        delay: Duration::ZERO,
        fail: false,
        relevant: &["ai", "documents"],
    });
    let service: Arc<dyn Cognition> = classifier.clone();
    let result = select_documentation(
        &user(),
        &"x".repeat(20000),
        Some(&service),
        &CancellationToken::new(),
    )
    .await;
    assert!(result.contains("### ai"));
    assert!(result.contains("### documents"));
    assert!(!result.contains("### email"));
    assert!(result.contains("email:"));
    assert!(result.len() <= 48 * 1024);
    let requests = classifier.requests.lock().unwrap();
    assert_eq!(requests.len(), 1);
    assert!(requests[0].questions.len() <= 32);
    assert_eq!(
        requests[0].input["userRequest"].as_str().unwrap().len(),
        8000
    );
    requests[0].validate().unwrap();
}

#[test]
fn namespace_overview_is_not_duplicated_in_discovery_responses() {
    let doc: SdkDocumentation = serde_json::from_value(serde_json::json!({
        "name": "documents",
        "description": "Documents",
        "documentation": "Full API reference",
        "overview": "Namespace reference"
    }))
    .unwrap();
    assert_eq!(doc.overview.as_deref(), Some("Namespace reference"));
    let response = serde_json::to_value(doc).unwrap();
    assert!(response.get("overview").is_none());
    assert_eq!(response["documentation"], "Full API reference");
}
#[tokio::test]
async fn errors_and_absent_provider_retain_catalog() {
    let classifier: Arc<dyn Cognition> = Arc::new(Classifier {
        requests: Mutex::new(vec![]),
        delay: Duration::ZERO,
        fail: true,
        relevant: &["ai", "documents"],
    });
    let fallback = select_documentation(&user(), "request", None, &CancellationToken::new()).await;
    assert_eq!(
        select_documentation(
            &user(),
            "request",
            Some(&classifier),
            &CancellationToken::new()
        )
        .await,
        fallback
    );
    assert!(fallback.ends_with("</macro_sdk>\n"));
}
#[tokio::test]
async fn deadline_and_cancellation_fall_back_without_waiting_for_provider() {
    let classifier: Arc<dyn Cognition> = Arc::new(Classifier {
        requests: Mutex::new(vec![]),
        delay: Duration::from_secs(30),
        fail: false,
        relevant: &["ai", "documents"],
    });
    let fallback = select_documentation(&user(), "request", None, &CancellationToken::new()).await;
    let result = tokio::time::timeout(
        Duration::from_millis(1500),
        select_documentation(
            &user(),
            "request",
            Some(&classifier),
            &CancellationToken::new(),
        ),
    )
    .await
    .unwrap();
    assert_eq!(result, fallback);
    let cancel = CancellationToken::new();
    cancel.cancel();
    let result = tokio::time::timeout(
        Duration::from_millis(50),
        select_documentation(&user(), "request", Some(&classifier), &cancel),
    )
    .await
    .unwrap();
    assert_eq!(result, fallback);
}

#[tokio::test]
async fn task_documentation_returns_every_relevant_entity_within_budget() {
    let classifier: Arc<dyn Cognition> = Arc::new(Classifier {
        requests: Mutex::new(vec![]),
        delay: Duration::ZERO,
        fail: false,
        relevant: &["ai", "documents"],
    });
    let catalog = sdk_documentation();
    let result = documentation_for_task(
        &user(),
        "summarize my recent documents",
        Some(&classifier),
        &CancellationToken::new(),
    )
    .await;
    assert_eq!(result.status, SelectionStatus::Selected);
    let mut names: Vec<_> = result
        .entities
        .iter()
        .map(|doc| doc.name.as_str())
        .collect();
    names.sort();
    assert_eq!(names, ["ai", "documents"]);
    let full = |name: &str| catalog.iter().find(|entry| entry.name == name).unwrap();
    // ai fits whole; documents' full reference then exceeds the budget.
    assert_eq!(result.entities[0].documentation, full("ai").documentation);
    assert_eq!(result.entities[1].documentation, full("documents").overview);
    assert!(result.omitted.is_empty());
}

#[tokio::test]
async fn task_documentation_stays_within_budget_and_names_omissions() {
    let classifier: Arc<dyn Cognition> = Arc::new(Classifier {
        requests: Mutex::new(vec![]),
        delay: Duration::ZERO,
        fail: false,
        relevant: &[],
    });
    let result = documentation_for_task(
        &user(),
        "everything",
        Some(&classifier),
        &CancellationToken::new(),
    )
    .await;
    let bytes: usize = result
        .entities
        .iter()
        .map(|doc| doc.documentation.as_ref().unwrap().len())
        .sum();
    assert!(bytes <= 32 * 1024);
    assert!(!result.omitted.is_empty());
    assert_eq!(
        result.entities.len() + result.omitted.len(),
        sdk_documentation().len()
    );
}

#[tokio::test]
async fn task_documentation_reports_why_nothing_was_selected() {
    let result = documentation_for_task(&user(), "anything", None, &CancellationToken::new()).await;
    assert_eq!(result.status, SelectionStatus::Unconfigured);
    assert!(result.entities.is_empty());
    let classifier: Arc<dyn Cognition> = Arc::new(Classifier {
        requests: Mutex::new(vec![]),
        delay: Duration::ZERO,
        fail: true,
        relevant: &[],
    });
    let result = documentation_for_task(
        &user(),
        "anything",
        Some(&classifier),
        &CancellationToken::new(),
    )
    .await;
    assert_eq!(result.status, SelectionStatus::ProviderError);
    assert!(result.entities.is_empty());
}
