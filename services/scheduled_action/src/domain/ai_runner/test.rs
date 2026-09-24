use super::*;
use ai_billing::domain::{AiAdmissionError, DenyReason};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::{collections::VecDeque, future::Future, pin::Pin, sync::Mutex};

pub(crate) struct Admission {
    decisions: Mutex<VecDeque<std::result::Result<(), AiAdmissionError>>>,
    pub(crate) calls: Mutex<Vec<(MacroUserIdStr<'static>, AiFeature)>>,
}

impl Admission {
    pub(crate) fn new(decisions: Vec<std::result::Result<(), AiAdmissionError>>) -> Self {
        Self {
            decisions: Mutex::new(decisions.into()),
            calls: Mutex::new(vec![]),
        }
    }
}

impl AiAdmissionService for Admission {
    fn admit<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        feature: AiFeature,
    ) -> Pin<Box<dyn Future<Output = std::result::Result<(), AiAdmissionError>> + Send + 'a>> {
        Box::pin(async move {
            self.calls
                .lock()
                .unwrap()
                .push((user.clone().into_owned(), feature));
            self.decisions
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected admission check")
        })
    }
}

pub(crate) fn failures() -> [AiAdmissionError; 2] {
    [
        AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
        AiAdmissionError::Unavailable(rootcause::report!("secret billing details")),
    ]
}

#[derive(Default)]
struct Runner {
    calls: Mutex<Vec<&'static str>>,
}

impl ScheduledAgentRunner for Runner {
    async fn create_chat(&self, _: &ScheduledAction) -> Result<String> {
        self.calls.lock().unwrap().push("create");
        Ok("chat".into())
    }

    async fn run(&self, _: &ScheduledAction, chat: &str, _: Option<&EventReference>) -> Result<()> {
        assert_eq!(chat, "chat");
        self.calls.lock().unwrap().push("run");
        Ok(())
    }
}

async fn action() -> ScheduledAction {
    use crate::domain::{
        models::CreateScheduledAction, ports::ScheduledActionService, service::test,
    };
    test::service(true)
        .create_action(
            CreateScheduledAction::Canonical(test::configuration(false)),
            test::user(),
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn admission_precedes_chat_and_is_not_rechecked_during_the_run() {
    let admission = Arc::new(Admission::new(vec![Ok(())]));
    let runner = AdmittedScheduledAgentRunner::new(Runner::default(), admission.clone());
    let action = action().await;
    let chat = runner.create_chat(&action).await.unwrap();
    runner.run(&action, &chat, None).await.unwrap();
    assert_eq!(*runner.inner.calls.lock().unwrap(), vec!["create", "run"]);
    assert_eq!(
        *admission.calls.lock().unwrap(),
        vec![(action.owner_user().unwrap().clone(), AiFeature::Automation)]
    );
}

#[tokio::test]
async fn failed_admission_preserves_typed_error_without_creating_chat() {
    for failure in failures() {
        let admission = Arc::new(Admission::new(vec![Err(failure)]));
        let runner = AdmittedScheduledAgentRunner::new(Runner::default(), admission);
        let error = runner.create_chat(&action().await).await.unwrap_err();
        assert!(error.is::<AiAdmissionError>());
        assert!(runner.inner.calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn invalid_owner_is_not_replaced_with_system_identity() {
    let admission = Arc::new(Admission::new(vec![]));
    let runner = AdmittedScheduledAgentRunner::new(Runner::default(), admission.clone());
    let mut action = action().await;
    action.owner = model_owner::Owner::Team(macro_uuid::generate_uuid_v7());
    assert!(runner.create_chat(&action).await.is_err());
    assert!(admission.calls.lock().unwrap().is_empty());
    assert!(runner.inner.calls.lock().unwrap().is_empty());
}
