use std::pin::Pin;
use std::sync::Mutex;

use macro_user_id::user_id::MacroUserIdStr;

use super::*;

#[derive(Default)]
struct Service {
    list_callers: Mutex<Vec<MacroUserIdStr<'static>>>,
    created: Mutex<Vec<DispatchCodingAgentRequest>>,
}

impl CodingAgentService for Service {
    fn list_updates(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<crate::domain::updates::AgentUpdates, CodingAgentError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(async move {
            self.list_callers.lock().unwrap().push(user_id);
            Ok(crate::domain::updates::AgentUpdates {
                items: Vec::new(),
                truncated: false,
                truncation_notice: None,
            })
        })
    }
    fn create(
        &self,
        command: DispatchCodingAgentRequest,
    ) -> Pin<Box<dyn Future<Output = Result<DispatchedCodingAgent, CodingAgentError>> + Send + '_>>
    {
        Box::pin(async move {
            let response = DispatchedCodingAgent {
                agent_session_id: macro_uuid::generate_uuid_v7(),
                agent_id: command.agent_id,
                agent_name: "Coder".into(),
            };
            self.created.lock().unwrap().push(command);
            Ok(response)
        })
    }
}

#[tokio::test]
async fn tools_always_use_the_authenticated_request_identity() {
    let service = Arc::new(Service::default());
    let context = ServiceContext(CodingAgentToolContext {
        service: service.clone(),
        sessions: service.clone(),
    });
    let caller = MacroUserIdStr::try_from("macro|requester@example.com".to_owned()).unwrap();
    let request = RequestContext::new(caller.clone());
    let updates = ListAgentUpdates {}
        .call(context.clone(), request.clone())
        .await
        .unwrap();
    assert!(updates.items.is_empty());
    assert_eq!(*service.list_callers.lock().unwrap(), vec![caller.clone()]);

    let tool = CreateAgentSession {
        agent_id: macro_uuid::generate_uuid_v7(),
        prompt: "Implement repository issue 123".into(),
    };
    let response = tool.call(context, request).await.unwrap();
    let created = service.created.lock().unwrap();
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].user_id, caller);
    assert_eq!(created[0].agent_id, tool.agent_id);
    assert_eq!(created[0].prompt, tool.prompt);
    assert_eq!(response.agent_id, tool.agent_id);
}

#[test]
fn tools_reject_an_ai_supplied_user_identity() {
    assert!(
        serde_json::from_value::<ListAgentUpdates>(
            serde_json::json!({"user_id": "macro|another@example.com"})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<CreateAgentSession>(serde_json::json!({
            "agentId": macro_uuid::generate_uuid_v7(),
            "prompt": "Fix the bug",
            "userId": "macro|another@example.com"
        }))
        .is_err()
    );
}

impl crate::domain::tool_actions::SessionActions for Service {
    fn execute(
        &self,
        _user: MacroUserIdStr<'static>,
        _id: Uuid,
        _action: crate::domain::tool_actions::SessionAction,
    ) -> Pin<
        Box<
            dyn Future<
                    Output = Result<
                        crate::domain::tool_actions::SessionActionResult,
                        crate::domain::tool_actions::SessionActionError,
                    >,
                > + Send
                + '_,
        >,
    > {
        Box::pin(async { panic!("this test must not invoke session management") })
    }
}
