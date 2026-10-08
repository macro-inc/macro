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
                agent_id: command.agent_id,
                agent_name: "Coder".into(),
            };
            self.dispatched.lock().unwrap().push(command);
            Ok(response)
        })
    }
}

#[tokio::test]
async fn tools_always_use_the_authenticated_request_identity() {
    let service = Arc::new(Service::default());
    let context = ServiceContext(CodingAgentToolContext {
        service: service.clone(),
    });
    let caller = MacroUserIdStr::try_from("macro|requester@example.com".to_owned()).unwrap();
    let request = RequestContext::new(caller.clone());
    let listed = ListCodingAgents {}
        .call(context.clone(), request.clone())
        .await
        .unwrap();
    assert!(listed.agents.is_empty());
    assert_eq!(*service.list_callers.lock().unwrap(), vec![caller.clone()]);

    let tool = DispatchCodingAgent {
        agent_id: macro_uuid::generate_uuid_v7(),
        prompt: "Implement repository issue 123".into(),
    };
    let response = tool.call(context, request).await.unwrap();
    let dispatched = service.dispatched.lock().unwrap();
    assert_eq!(dispatched.len(), 1);
    assert_eq!(dispatched[0].user_id, caller);
    assert_eq!(dispatched[0].agent_id, tool.agent_id);
    assert_eq!(dispatched[0].prompt, tool.prompt);
    assert_eq!(response.agent_id, tool.agent_id);
}

#[test]
fn tools_reject_an_ai_supplied_user_identity() {
    assert!(
        serde_json::from_value::<ListCodingAgents>(serde_json::json!({
            "user_id": "macro|another@example.com"
        }))
        .is_err()
    );
    assert!(
        serde_json::from_value::<DispatchCodingAgent>(serde_json::json!({
            "agent_id": macro_uuid::generate_uuid_v7(),
            "prompt": "Fix the bug",
            "user_id": "macro|another@example.com"
        }))
        .is_err()
    );
}
