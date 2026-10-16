use super::*;
use async_trait::async_trait;
use cognition::domain::{DecisionResponse, GenerateObjectRequest, GenerateObjectResponse};
use rootcause::Report;
use std::sync::Mutex;

struct Classifier {
    requests: Mutex<Vec<DecisionRequest>>,
    delay: Duration,
    fail: bool,
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
                    if ["ai", "documents"].contains(&name.as_str()) {
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
