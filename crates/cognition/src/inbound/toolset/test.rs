use super::*;
use ai_toolset::{ToolSet, schema::generate_validated_input_schema};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};
use std::{collections::BTreeMap, sync::Mutex};

#[derive(Default)]
struct FakeCognition {
    requests: Mutex<Vec<(String, Value)>>,
    fail: bool,
}

#[async_trait]
impl Cognition for FakeCognition {
    async fn generate_object(
        &self,
        user: &MacroUserIdStr<'static>,
        request: GenerateObjectRequest,
    ) -> Result<GenerateObjectResponse, Report> {
        self.requests
            .lock()
            .unwrap()
            .push((user.to_string(), serde_json::to_value(request)?));
        if self.fail {
            return Err(CognitionError::AllowanceExceeded.into());
        }
        Ok(GenerateObjectResponse {
            object: json!({"total":42}),
        })
    }

    async fn decide(
        &self,
        user: &MacroUserIdStr<'static>,
        request: DecisionRequest,
    ) -> Result<DecisionResponse, Report> {
        self.requests
            .lock()
            .unwrap()
            .push((user.to_string(), serde_json::to_value(&request)?));
        Ok(DecisionResponse {
            probabilities: request
                .questions
                .into_keys()
                .map(|name| (name, 0.75))
                .collect(),
        })
    }
}

fn request() -> RequestContext {
    RequestContext::new(MacroUserIdStr::try_from("macro|requester@macro.local".to_owned()).unwrap())
}

fn context(service: Arc<FakeCognition>) -> ServiceContext<CognitionToolContext> {
    ServiceContext(CognitionToolContext {
        service: Some(service),
    })
}

fn generation() -> GenerateObject {
    serde_json::from_value(json!({
        "prompt": "Extract the total: USD 42.",
        "schema": { "type": "object", "properties": { "total": { "type": "number" } } },
    }))
    .unwrap()
}

#[test]
fn both_ordinary_tools_have_named_object_schemas_and_strict_inputs() {
    let generation = generate_validated_input_schema::<GenerateObject>().unwrap();
    assert_eq!(generation.name, "GenerateObject");
    assert!(generation.schema.as_value()["properties"]["schema"].is_object());
    let decision = generate_validated_input_schema::<Decide>().unwrap();
    assert_eq!(decision.name, "Decide");
    assert!(decision.schema.as_value()["properties"]["questions"].is_object());
    let mut names = cognition_toolset()
        .request_schemas()
        .unwrap()
        .into_iter()
        .map(|schema| schema.name)
        .collect::<Vec<_>>();
    names.sort();
    assert_eq!(names, ["Decide", "GenerateObject"]);
    assert!(
        serde_json::from_value::<GenerateObject>(json!({
            "prompt":"x", "schema":{"type":"object"}, "userId":"someone-else",
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<Decide>(json!({
            "input":"x", "questions":{"relevant":"Is it relevant?"}, "owner":"someone-else",
        }))
        .is_err()
    );
}

#[tokio::test]
async fn both_tools_forward_authenticated_owner_and_preserve_results() {
    let service = Arc::new(FakeCognition::default());
    let result = generation()
        .call(context(service.clone()), request())
        .await
        .unwrap();
    assert_eq!(result.object, json!({"total":42}));
    let tool = Decide(DecisionRequest {
        input: json!({"email":"Please respond today."}),
        questions: BTreeMap::from([("needsReply".into(), "Does it request a response?".into())]),
    });
    let result = tool
        .call(context(service.clone()), request())
        .await
        .unwrap();
    assert_eq!(
        result.probabilities,
        BTreeMap::from([("needsReply".into(), 0.75)])
    );
    let requests = service.requests.lock().unwrap();
    assert_eq!(requests.len(), 2);
    assert!(
        requests
            .iter()
            .all(|(owner, _)| owner == "macro|requester@macro.local")
    );
    assert_eq!(requests[0].1["prompt"], "Extract the total: USD 42.");
    assert_eq!(
        requests[1].1["input"],
        json!({"email":"Please respond today."})
    );
}

#[tokio::test]
async fn cancelled_requests_do_not_start_provider_work() {
    let service = Arc::new(FakeCognition::default());
    let request = request();
    request.cancel.cancel();
    let error = generation()
        .call(context(service.clone()), request)
        .await
        .unwrap_err();
    assert!(error.description.contains("cancelled"));
    assert!(service.requests.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unconfigured_context_and_service_denial_remain_errors() {
    let error = generation()
        .call(ServiceContext(CognitionToolContext::default()), request())
        .await
        .unwrap_err();
    assert!(error.description.contains("not configured"));
    let service = Arc::new(FakeCognition {
        fail: true,
        ..Default::default()
    });
    let error = generation()
        .call(context(service), request())
        .await
        .unwrap_err();
    assert!(error.description.contains("allowance is exhausted"));
}
