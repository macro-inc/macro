use std::collections::BTreeMap;

use super::*;
use crate::domain::agent::{
    AgentEnrollment, AgentEnrollmentError, AgentEnrollmentFuture, AgentEnrollmentSource,
    AgentEnv, AgentEnvKey,
};

fn ada() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|ada-1@agents.macro.invalid".to_owned()).unwrap()
}

fn ada_enrollment() -> AgentEnrollment {
    let mut values = BTreeMap::new();
    values.insert(
        AgentEnvKey::new("MACRO_API_KEY").unwrap(),
        "mak_ada".to_owned(),
    );
    AgentEnrollment {
        agent_user_id: ada(),
        env: AgentEnv::new(values).unwrap(),
    }
}

struct AdaRuns {
    issued: Mutex<Vec<(ComputerId, EnrollmentGeneration)>>,
}

impl AgentEnrollmentSource for AdaRuns {
    fn issue(
        &self,
        computer: ComputerId,
        generation: EnrollmentGeneration,
    ) -> AgentEnrollmentFuture<'_> {
        self.issued.lock().unwrap().push((computer, generation));
        Box::pin(async { Ok(Some(ada_enrollment())) })
    }
}

struct Unavailable;

impl AgentEnrollmentSource for Unavailable {
    fn issue(&self, _: ComputerId, _: EnrollmentGeneration) -> AgentEnrollmentFuture<'_> {
        Box::pin(async { Err(AgentEnrollmentError::Unavailable) })
    }
}

#[tokio::test]
async fn an_agent_computer_enrolls_with_its_agent() {
    let source = std::sync::Arc::new(AdaRuns {
        issued: Mutex::new(vec![]),
    });
    let operator = operator(FakeFleet::default())
        .await
        .with_agent_enrollment(source.clone());
    let id = paid_computer(&operator).await;

    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);

    assert_eq!(
        *source.issued.lock().unwrap(),
        vec![(id, EnrollmentGeneration::new(1))]
    );
    let enrollments = operator.fleet.enrollments.lock().unwrap();
    assert_eq!(enrollments.len(), 1);
    assert_eq!(enrollments[0].0.agent, Some(ada_enrollment()));
}

#[tokio::test]
async fn an_agent_computer_never_enrolls_without_its_agent() {
    let operator = operator(FakeFleet::default())
        .await
        .with_agent_enrollment(std::sync::Arc::new(Unavailable));
    paid_computer(&operator).await;

    operator.run_fleet_effects().await.unwrap();

    assert!(
        operator.fleet.enrollments.lock().unwrap().is_empty(),
        "no enrollment reached the guest"
    );
}
