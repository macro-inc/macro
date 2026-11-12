use std::sync::{Arc, Mutex};

use super::*;
use crate::domain::models::{ComputerId, ComputerPurchase, TeamAgentError};

const TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00aa);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00bb);
const COMPUTER: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00c1);

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn agent() -> MacroUserIdStr<'static> {
    user("macro|sam-rivera-abc123@agents.macro.invalid")
}

fn admin() -> MacroUserIdStr<'static> {
    user("macro|admin@example.com")
}

fn facts() -> AgentAccountFacts {
    AgentAccountFacts {
        team_id: TEAM,
        is_agent: true,
        member: true,
        created_by: Some(admin()),
        created_by_is_agent: false,
    }
}

#[derive(Debug, thiserror::Error)]
#[error("storage is down")]
struct Down;

#[derive(Clone, Default)]
struct FakeAccounts {
    facts: Option<AgentAccountFacts>,
    down: bool,
}

impl AgentAccounts for FakeAccounts {
    type Err = Down;

    async fn account_facts(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<Option<AgentAccountFacts>, Down> {
        if self.down {
            return Err(Down);
        }
        Ok(self.facts.clone())
    }
}

#[derive(Clone, Default)]
struct FakeComputers {
    computer: Option<ComputerState>,
    lookup_down: bool,
    state_down: bool,
    calls: Arc<Mutex<Vec<&'static str>>>,
}

impl Computers for FakeComputers {
    async fn purchase(&self, _: ComputerPurchase) -> Result<ComputerId, TeamAgentError> {
        unreachable!("admission never buys")
    }

    async fn computer_for_agent(
        &self,
        _: Uuid,
        _: &MacroUserIdStr<'_>,
    ) -> Result<Option<ComputerId>, TeamAgentError> {
        self.calls.lock().unwrap().push("computer_for_agent");
        if self.lookup_down {
            return Err(TeamAgentError::internal(Down));
        }
        Ok(self.computer.map(|_| ComputerId::new_from_uuid(COMPUTER)))
    }

    async fn agent_of(
        &self,
        _: ComputerId,
    ) -> Result<Option<MacroUserIdStr<'static>>, TeamAgentError> {
        unreachable!("admission looks computers up by agent")
    }

    async fn state(&self, _: Uuid, _: ComputerId) -> Result<ComputerState, TeamAgentError> {
        self.calls.lock().unwrap().push("state");
        if self.state_down {
            return Err(TeamAgentError::internal(Down));
        }
        Ok(self.computer.expect("state of a computer that exists"))
    }

    async fn release(&self, _: Uuid, _: ComputerId) -> Result<(), TeamAgentError> {
        unreachable!("admission never releases")
    }
}

fn admission(
    accounts: FakeAccounts,
    computers: FakeComputers,
) -> AgentAdmission<FakeAccounts, FakeComputers> {
    AgentAdmission::new(accounts, computers)
}

fn running() -> FakeComputers {
    FakeComputers {
        computer: Some(ComputerState::Ready),
        ..FakeComputers::default()
    }
}

#[tokio::test]
async fn an_agent_of_the_team_with_a_running_computer_is_admitted_with_its_creator() {
    let admitted = admission(
        FakeAccounts {
            facts: Some(facts()),
            down: false,
        },
        running(),
    )
    .admit(&agent(), TEAM)
    .await
    .unwrap();

    assert_eq!(
        admitted,
        AdmittedAgent {
            agent_user_id: agent(),
            team_id: TEAM,
            responsible_human_user_id: admin(),
        }
    );
}

#[test]
fn each_missing_fact_is_its_own_refusal() {
    let decided = |account: Option<AgentAccountFacts>, computer: Option<ComputerState>| {
        decide(&agent(), TEAM, account, computer)
    };
    let ready = Some(ComputerState::Ready);
    let cases = [
        (None, ready, NotAdmitted::NotAnAgent),
        (
            Some(AgentAccountFacts {
                is_agent: false,
                ..facts()
            }),
            ready,
            NotAdmitted::NotAnAgent,
        ),
        (
            Some(AgentAccountFacts {
                team_id: OTHER_TEAM,
                ..facts()
            }),
            ready,
            NotAdmitted::OtherTeam,
        ),
        (
            Some(AgentAccountFacts {
                member: false,
                ..facts()
            }),
            ready,
            NotAdmitted::NotAMember,
        ),
        (
            Some(AgentAccountFacts {
                created_by: None,
                ..facts()
            }),
            ready,
            NotAdmitted::NoResponsibleHuman,
        ),
        (
            Some(AgentAccountFacts {
                created_by_is_agent: true,
                ..facts()
            }),
            ready,
            NotAdmitted::NoResponsibleHuman,
        ),
        (Some(facts()), None, NotAdmitted::NoComputer),
        (
            Some(facts()),
            Some(ComputerState::Purchasing),
            NotAdmitted::NoComputer,
        ),
        (
            Some(facts()),
            Some(ComputerState::Released),
            NotAdmitted::ComputerReleased,
        ),
    ];
    for (account, computer, refused) in cases {
        assert_eq!(decided(account, computer), Err(refused));
    }
}

#[test]
fn a_computer_that_is_not_released_counts_whatever_it_is_doing() {
    for state in [
        ComputerState::SettingUp,
        ComputerState::Ready,
        ComputerState::Paused,
        ComputerState::Failed,
    ] {
        assert!(decide(&agent(), TEAM, Some(facts()), Some(state)).is_ok());
    }
}

#[tokio::test]
async fn an_account_that_is_not_admitted_is_refused_before_any_computer_lookup() {
    let computers = running();
    let refused = admission(
        FakeAccounts {
            facts: Some(AgentAccountFacts {
                team_id: OTHER_TEAM,
                ..facts()
            }),
            down: false,
        },
        computers.clone(),
    )
    .admit(&agent(), TEAM)
    .await;

    assert!(matches!(
        refused,
        Err(AdmissionError::NotAdmitted(NotAdmitted::OtherTeam))
    ));
    assert!(computers.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn any_dependency_failing_is_unavailable_never_admitted() {
    let up = FakeAccounts {
        facts: Some(facts()),
        down: false,
    };
    let cases = [
        (
            FakeAccounts {
                facts: Some(facts()),
                down: true,
            },
            running(),
        ),
        (
            up.clone(),
            FakeComputers {
                lookup_down: true,
                ..running()
            },
        ),
        (
            up,
            FakeComputers {
                state_down: true,
                ..running()
            },
        ),
    ];
    for (accounts, computers) in cases {
        assert!(matches!(
            admission(accounts, computers).admit(&agent(), TEAM).await,
            Err(AdmissionError::Unavailable)
        ));
    }
}
