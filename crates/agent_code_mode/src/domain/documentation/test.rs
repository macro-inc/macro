use super::*;
use async_trait::async_trait;
use cognition::domain::{
    DecisionRequest, DecisionResponse, GenerateObjectRequest, GenerateObjectResponse,
};
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
            .iter()
            .map(|(key, question)| {
                // "Would the SDK entity <name> help with this request? …"
                let name = question.split_whitespace().nth(4).unwrap();
                let relevant = self.relevant.is_empty() || self.relevant.contains(&name);
                (key.clone(), if relevant { 0.9 } else { 0.1 })
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
        Guidance::Inline,
        &CancellationToken::new(),
    )
    .await;
    // Unrouted turns carry area guidance in their prompt, not here.
    assert!(!result.contains(entity_guide("documents").unwrap()));
    assert!(result.contains("\n## ai\n"));
    assert!(result.contains("\n## documents\n"));
    assert!(!result.contains("\n## email\n"));
    assert!(result.contains("email:"));
    assert!(result.len() <= 48 * 1024);
    let requests = classifier.requests.lock().unwrap();
    for request in requests.iter() {
        assert_eq!(request.input["userRequest"].as_str().unwrap().len(), 8000);
        request.validate().unwrap();
    }
}

#[tokio::test]
async fn errors_and_absent_provider_retain_catalog() {
    let classifier: Arc<dyn Cognition> = Arc::new(Classifier {
        requests: Mutex::new(vec![]),
        delay: Duration::ZERO,
        fail: true,
        relevant: &["ai", "documents"],
    });
    let fallback = select_documentation(
        &user(),
        "request",
        None,
        Guidance::Inline,
        &CancellationToken::new(),
    )
    .await;
    assert_eq!(
        select_documentation(
            &user(),
            "request",
            Some(&classifier),
            Guidance::Inline,
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
    let fallback = select_documentation(
        &user(),
        "request",
        None,
        Guidance::Inline,
        &CancellationToken::new(),
    )
    .await;
    let result = tokio::time::timeout(
        Duration::from_millis(1500),
        select_documentation(
            &user(),
            "request",
            Some(&classifier),
            Guidance::Inline,
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
        select_documentation(
            &user(),
            "request",
            Some(&classifier),
            Guidance::Inline,
            &cancel,
        ),
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
    let index = |name: &str| {
        catalog
            .iter()
            .find(|entry| entry.name == name)
            .unwrap()
            .index
            .clone()
    };
    assert_eq!(result.entities[0].index, index("ai"));
    assert_eq!(result.entities[1].index, index("documents"));
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
        .map(|doc| doc.index.as_ref().unwrap().len())
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

#[test]
fn symbol_references_stay_within_one_result_budget() {
    // The largest references, requested together, overflow one result: the
    // first is read and the rest are named for another request.
    let symbols: Vec<String> = [
        "NotifEvent",
        "calendar.CalendarEvent",
        "email.CalendarEvent",
        "CallRecord",
        "storage.CallRecord",
        "EmailFilters",
        "Document",
        "Database",
        "Channel",
        "Task",
    ]
    .map(String::from)
    .to_vec();
    let result = read_symbols(&symbols);
    let bytes: usize = result
        .references
        .iter()
        .map(|reference| reference.reference.len())
        .sum();
    assert!(bytes <= 32 * 1024);
    assert_eq!(result.references[0].symbol, "NotifEvent");
    assert!(!result.omitted.is_empty());
    assert_eq!(
        result.references.len() + result.omitted.len(),
        symbols.len()
    );
    assert!(result.unknown.is_empty());
}

#[tokio::test]
async fn routed_turns_bring_each_selected_entitys_guidance_with_its_index() {
    let classifier: Arc<dyn Cognition> = Arc::new(Classifier {
        requests: Mutex::new(vec![]),
        delay: Duration::ZERO,
        fail: false,
        relevant: &["databases"],
    });
    let result = select_documentation(
        &user(),
        "how many rows in Leads have revenue over 10k?",
        Some(&classifier),
        Guidance::Selected,
        &CancellationToken::new(),
    )
    .await;
    assert!(result.contains("\n## databases\n"));
    assert!(result.contains(entity_guide("databases").unwrap()));
    assert!(!result.contains(entity_guide("crm").unwrap()));
    assert!(result.len() <= 48 * 1024);
}

#[test]
fn inline_guides_carry_every_area_but_the_search_guide() {
    let code = inline_guides(GuideHost::Code);
    let direct = inline_guides(GuideHost::Direct);
    for doc in sdk_documentation() {
        let Some(guide) = doc.guide.as_deref() else {
            continue;
        };
        assert_eq!(code.contains(guide), doc.name != "search", "{}", doc.name);
        assert_eq!(
            direct.contains(guide),
            !["search", "agentSessions", "tasks"].contains(&doc.name.as_str()),
            "{}",
            doc.name
        );
    }
    assert!(code.contains("check every database's tables"));
    assert!(direct.contains("A form for a channel is a poll:"));
}

#[test]
fn mcp_clients_get_the_database_crm_and_document_content_rules() {
    let mcp = mcp_guides();
    assert!(mcp.contains("check every database's tables"));
    assert!(mcp.contains("A pipeline is not a Macro database"));
    assert!(mcp.contains("<m-document-mention>"));
    assert!(mcp.contains("even when `CreateDocument` is called through the MCP server"));
    assert!(!mcp.contains("A form for a channel is a poll:"));
}

#[test]
fn every_entity_routes_on_a_use_when_sentence() {
    for doc in sdk_documentation() {
        assert!(doc.description.starts_with("Use when "), "{}", doc.name);
        assert!(doc.description.contains("; not "), "{}", doc.name);
    }
    assert!(search_guide().contains("macro.documents.search"));
}

#[tokio::test]
async fn entities_past_the_first_32_route_in_another_parallel_call() {
    let catalog = sdk_documentation();
    assert!(catalog.len() > 32);
    let in_second_call = catalog[32].name.as_str();
    let classifier = Arc::new(Classifier {
        requests: Mutex::new(vec![]),
        delay: Duration::ZERO,
        fail: false,
        relevant: Vec::leak(vec![in_second_call]),
    });
    let service: Arc<dyn Cognition> = classifier.clone();

    let result = select_documentation(
        &user(),
        "request",
        Some(&service),
        Guidance::Inline,
        &CancellationToken::new(),
    )
    .await;

    let sizes: Vec<usize> = classifier
        .requests
        .lock()
        .unwrap()
        .iter()
        .map(|request| request.questions.len())
        .collect();
    assert_eq!(sizes.len(), catalog.len().div_ceil(32));
    assert!(sizes.iter().all(|size| *size <= 32));
    assert_eq!(sizes.iter().sum::<usize>(), catalog.len());
    assert!(result.contains(catalog[32].index.as_deref().unwrap()));
}
