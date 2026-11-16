use std::sync::{Arc, Mutex};

use super::*;
use hosted_runtimes::domain::ids::ComputerId;

const TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00aa);
const OTHER_TEAM: Uuid = Uuid::from_u128(0x0193_a1b2_0000_7000_8000_0000_0000_00bb);

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
    live: bool,
    down: bool,
    calls: Arc<Mutex<u32>>,
}

impl ComputerAgents for FakeComputers {
    type Error = Down;

    async fn agent_of(&self, _: ComputerId) -> Result<Option<MacroUserIdStr<'static>>, Down> {
        unreachable!("admission looks computers up by agent")
    }

    async fn computer_for_agent(
        &self,
        _: Uuid,
        _: &MacroUserIdStr<'_>,
    ) -> Result<Option<ComputerId>, Down> {
        unreachable!("admission asks only whether one is live")
    }

    async fn has_live_computer(&self, _: Uuid, _: &MacroUserIdStr<'_>) -> Result<bool, Down> {
        *self.calls.lock().unwrap() += 1;
        if self.down {
            return Err(Down);
        }
        Ok(self.live)
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
        live: true,
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
    let decided =
        |account: Option<AgentAccountFacts>, live: bool| decide(&agent(), TEAM, account, live);
    let ready = true;
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
        (Some(facts()), false, NotAdmitted::NoLiveComputer),
    ];
    for (account, computer, refused) in cases {
        assert_eq!(decided(account, computer), Err(refused));
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
    assert_eq!(*computers.calls.lock().unwrap(), 0);
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
            up,
            FakeComputers {
                down: true,
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

#[tokio::test]
async fn resolving_an_account_admits_it_to_its_own_team_or_finds_no_agent() {
    let up = |facts: Option<AgentAccountFacts>| FakeAccounts { facts, down: false };

    let resolved = admission(up(Some(facts())), running())
        .resolve(&agent())
        .await
        .unwrap();
    assert_eq!(
        resolved,
        Some(AdmittedAgent {
            agent_user_id: agent(),
            team_id: TEAM,
            responsible_human_user_id: admin(),
        })
    );

    assert_eq!(
        admission(up(None), running())
            .resolve(&agent())
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        admission(up(Some(facts())), FakeComputers::default())
            .resolve(&agent())
            .await
            .unwrap(),
        None
    );
    assert!(matches!(
        admission(
            FakeAccounts {
                facts: Some(facts()),
                down: true
            },
            running()
        )
        .resolve(&agent())
        .await,
        Err(AdmissionError::Unavailable)
    ));
}
