use crate::{
    ApprovalKind, AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated,
    ToolAnnotations, ToolResult, ToolSet as _,
};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use schemars::JsonSchema;
use serde::Deserialize;
use serde_json::{Value, json};

/// Answers with the approval its call carried.
#[derive(Deserialize, JsonSchema)]
#[schemars(title = "approval_probe", description = "Reports its call's approval.")]
struct ApprovalProbe {}

impl ToolAnnotated for ApprovalProbe {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Approval probe");
}

#[async_trait]
impl AsyncTool<()> for ApprovalProbe {
    type Output = Value;

    async fn call(
        &self,
        _service_context: ServiceContext<()>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        Ok(json!(
            request_context
                .approval()
                .map(|approval| format!("{:?}", approval.kind()))
        ))
    }
}

fn request_context() -> RequestContext {
    RequestContext::new(MacroUserIdStr::try_from_email("owner@example.com").unwrap())
}

/// A user tool runs only once a person has reviewed the call, so the run
/// carries their approval.
#[tokio::test]
async fn a_reviewed_user_tool_runs_with_the_users_approval() {
    let toolset = AsyncToolCollection::<()>::new().add_user_tool::<ApprovalProbe, ()>();
    let response = toolset
        .try_user_tool_call((), request_context(), "approval_probe", &json!({}))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        json!({"UserAction": "Reviewed"})
    );
}

/// A call the model makes carries no approval, whatever it passes.
#[tokio::test]
async fn a_models_call_carries_no_approval() {
    let toolset = AsyncToolCollection::<()>::new().add_tool::<ApprovalProbe, ()>();
    let answer = toolset
        .try_tool_call(
            (),
            request_context(),
            "approval_probe",
            &json!({"approval": "Reviewed"}),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(answer, Value::Null);
}

#[test]
fn a_quoted_reply_approves_the_call_and_a_blank_one_does_not() {
    let quoted = request_context()
        .with_quoted_confirmation("yes, book it")
        .unwrap();
    assert_eq!(
        quoted.approval().map(|approval| approval.kind()),
        Some(ApprovalKind::Quoted)
    );
    assert!(request_context().with_quoted_confirmation("  ").is_none());
}
