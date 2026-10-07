use std::pin::Pin;
use std::sync::Mutex;

use macro_user_id::user_id::MacroUserIdStr;

use super::*;

#[derive(Default)]
struct Service {
    list_callers: Mutex<Vec<MacroUserIdStr<'static>>>,
    dispatched: Mutex<Vec<DispatchCodingAgentRequest>>,
}

impl CodingAgentService for Service {
    fn list(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<CodingAgent>, CodingAgentError>> + Send + '_>> {
        Box::pin(async move {
            self.list_callers.lock().unwrap().push(user_id);
            Ok(Vec::new())
        })
    }

    fn dispatch(
        &self,
        command: DispatchCodingAgentRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DispatchedCodingAgent, CodingAgentError>> + Send + '_>>
    {
        Box::pin(async move {
            let response = DispatchedCodingAgent {
                agent_session_id: macro_uuid::generate_uuid_v7(),
                agent_id: command
                    .agent_id
                    .unwrap_or(bot_id::MACRO_NEW_BOT_ID.as_uuid()),
                agent_name: "Coder".into(),
            };
            self.dispatched.lock().unwrap().push(command);
            Ok(response)
        })
    }
}

#[tokio::test]
async fn start_session_forwards_launch_options_and_authenticated_identity() {
    let service = Arc::new(Service::default());
    let caller = MacroUserIdStr::try_from("macro|requester@example.com".to_owned()).unwrap();
    for agent in [
        None,
        Some("grungus".to_owned()),
        Some(macro_uuid::generate_uuid_v7().to_string()),
    ] {
        let tool = StartAgentSession {
            agent: agent.clone(),
            prompt: "Complete the task".into(),
            model: Some("chosen-model".into()),
            repo_url: Some("https://github.com/example/product".into()),
            repo_branch: Some("main".into()),
        };
        tool.call(
            ServiceContext(CodingAgentToolContext {
                service: service.clone(),
            }),
            RequestContext::new(caller.clone()),
        )
        .await
        .unwrap();
        let calls = service.dispatched.lock().unwrap();
        let call = calls.last().unwrap();
        assert_eq!(call.user_id, caller);
        assert_eq!(
            call.agent_id
                .map(|id| id.to_string())
                .or(call.agent_name.clone()),
            agent
        );
        assert_eq!(call.model, tool.model);
        assert_eq!(call.repo_url, tool.repo_url);
        assert_eq!(call.repo_branch, tool.repo_branch);
        assert_eq!(call.prompt, tool.prompt);
    }
}

#[test]
fn start_session_rejects_a_forged_caller() {
    assert!(
        serde_json::from_value::<StartAgentSession>(serde_json::json!({
            "prompt": "Task", "user_id": "macro|another@example.com"
        }))
        .is_err()
    );
}
