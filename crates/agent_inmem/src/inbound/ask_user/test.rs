use std::sync::{Arc, Mutex};

use ai_toolset::{AsyncTool as _, RequestContext, ServiceContext};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::user_input::{UserInputError, UserInputRequester};

struct FakeRequester {
    requests: Mutex<Vec<UserInputRequest>>,
    response: UserInputOutcome,
}

#[async_trait]
impl UserInputRequester for FakeRequester {
    async fn ask(&self, request: UserInputRequest) -> Result<UserInputOutcome, UserInputError> {
        self.requests
            .lock()
            .expect("request lock should not be poisoned")
            .push(request);
        Ok(self.response.clone())
    }
}

fn request_context() -> RequestContext {
    RequestContext::new(
        MacroUserIdStr::try_from("macro|ask-user-test@example.com".to_owned())
            .expect("test user id should be valid"),
    )
}

#[tokio::test]
async fn asks_through_the_port_and_returns_the_answer() {
    let requester = Arc::new(FakeRequester {
        requests: Mutex::new(Vec::new()),
        response: UserInputOutcome::Answered("blue".to_owned()),
    });
    let response = AskUser {
        question: "  What is the best colour?  ".to_owned(),
        options: vec![
            "red".to_owned(),
            " blue ".to_owned(),
            "red".to_owned(),
            String::new(),
        ],
    }
    .call(
        ServiceContext(AskUserContext {
            requester: Some(requester.clone()),
        }),
        request_context(),
    )
    .await
    .expect("the question should succeed");

    assert_eq!(
        response,
        AskUserResponse::Answered {
            answer: "blue".to_owned()
        }
    );
    assert_eq!(
        *requester
            .requests
            .lock()
            .expect("request lock should not be poisoned"),
        vec![UserInputRequest {
            question: "What is the best colour?".to_owned(),
            options: vec!["red".to_owned(), "blue".to_owned()],
        }]
    );
}

#[tokio::test]
async fn preserves_decline_and_cancel_as_successful_tool_results() {
    for (outcome, expected) in [
        (UserInputOutcome::Declined, AskUserResponse::Declined),
        (UserInputOutcome::Cancelled, AskUserResponse::Cancelled),
    ] {
        let response = AskUser {
            question: "Continue?".to_owned(),
            options: vec!["yes".to_owned(), "no".to_owned()],
        }
        .call(
            ServiceContext(AskUserContext {
                requester: Some(Arc::new(FakeRequester {
                    requests: Mutex::new(Vec::new()),
                    response: outcome,
                })),
            }),
            request_context(),
        )
        .await
        .expect("decline and cancel are user decisions, not tool failures");
        assert_eq!(response, expected);
    }
}

#[tokio::test]
async fn fails_clearly_without_client_support() {
    let error = AskUser {
        question: "Continue?".to_owned(),
        options: Vec::new(),
    }
    .call(
        ServiceContext(AskUserContext { requester: None }),
        request_context(),
    )
    .await
    .expect_err("an unsupported client cannot be asked");

    assert_eq!(
        error.description,
        "This client cannot show an interactive question."
    );
}

#[tokio::test]
async fn rejects_an_empty_question_without_calling_the_port() {
    let requester = Arc::new(FakeRequester {
        requests: Mutex::new(Vec::new()),
        response: UserInputOutcome::Answered("unused".to_owned()),
    });
    let error = AskUser {
        question: "   ".to_owned(),
        options: Vec::new(),
    }
    .call(
        ServiceContext(AskUserContext {
            requester: Some(requester.clone()),
        }),
        request_context(),
    )
    .await
    .expect_err("an empty question should be rejected");

    assert_eq!(error.description, "AskUser requires a non-empty question.");
    assert!(
        requester
            .requests
            .lock()
            .expect("request lock should not be poisoned")
            .is_empty()
    );
}
