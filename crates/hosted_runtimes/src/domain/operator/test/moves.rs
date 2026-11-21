//! A whole move through the operator's move pass, with fake hosts that
//! copy instantly: the first round of a computer copies 8 GiB, every later
//! one 10 MiB, and a round after a release is the final one.

use chrono::{DateTime, Utc};

use super::host_scope::{MICROVM, two_host_operator};
use super::*;
use crate::domain::lifecycle::Phase;
use crate::domain::moves::{ComputerMoves, HostMoves, MoveStage, MoveTicket, Round, RoundState};

const FIRST_ROUND_BYTES: u64 = 8 << 30;
const LATER_ROUND_BYTES: u64 = 10 << 20;

impl FakeFleet {
    fn log(&self, call: String) {
        self.calls.lock().unwrap().push(call);
    }

    fn logged(&self, prefix: &str) -> usize {
        self.calls
            .lock()
            .unwrap()
            .iter()
            .filter(|call| call.starts_with(prefix))
            .count()
    }
}

impl HostMoves for FakeFleet {
    type Err = FakeFleetError;

    async fn move_address(&self) -> Result<Option<String>, FakeFleetError> {
        Ok(Some("10.88.0.2:8446".to_owned()))
    }

    async fn expect_move(
        &self,
        computer_id: ComputerId,
        ticket: &MoveTicket,
        _expires_at: DateTime<Utc>,
    ) -> Result<(), FakeFleetError> {
        assert!(!ticket.expose().is_empty());
        self.log(format!("expect {computer_id}"));
        Ok(())
    }

    async fn replicate(
        &self,
        computer_id: ComputerId,
        target: &str,
        _ticket: &MoveTicket,
    ) -> Result<Round, FakeFleetError> {
        assert_eq!(target, "10.88.0.2:8446");
        self.log(format!("replicate {computer_id}"));
        self.replication(computer_id).await
    }

    async fn replication(&self, computer_id: ComputerId) -> Result<Round, FakeFleetError> {
        let calls = self.calls.lock().unwrap();
        let rounds: Vec<usize> = calls
            .iter()
            .enumerate()
            .filter(|(_, call)| **call == format!("replicate {computer_id}"))
            .map(|(index, _)| index)
            .collect();
        let Some(&last) = rounds.last() else {
            return Ok(Round {
                state: RoundState::Idle,
                released: false,
                bytes: 0,
            });
        };
        let released = calls[..last]
            .iter()
            .any(|call| *call == format!("release {computer_id}"));
        Ok(Round {
            state: RoundState::Done,
            released,
            bytes: if rounds.len() == 1 {
                FIRST_ROUND_BYTES
            } else {
                LATER_ROUND_BYTES
            },
        })
    }

    async fn release(&self, computer_id: ComputerId) -> Result<(), FakeFleetError> {
        if self.logged(&format!("release {computer_id}")) == 0 {
            self.log(format!("release {computer_id}"));
        }
        Ok(())
    }

    async fn adopt(
        &self,
        computer_id: ComputerId,
        _control_plane_id: &ControlPlaneId,
        _generation: EnrollmentGeneration,
    ) -> Result<(), FakeFleetError> {
        self.log(format!("adopt {computer_id}"));
        Ok(())
    }

    async fn drop_staged(&self, computer_id: ComputerId) -> Result<(), FakeFleetError> {
        self.log(format!("drop_staged {computer_id}"));
        Ok(())
    }
}

type TwoHostOperator = ComputerOperator<
    FakeRepo,
    super::host_scope::TwoHosts,
    FakeHarnesses,
    FixedClock,
    FakeSetupNotices,
>;

/// A paid computer on the home host, running with macrod connected.
async fn running_computer(operator: &TwoHostOperator) -> ComputerId {
    let id = paid_computer(operator).await;
    let mut computers = operator.repo.computers.lock().unwrap();
    let computer = computers.get_mut(&id).unwrap();
    computer.state.phase = Phase::Running;
    computer.state.macrod_connected = true;
    id
}

fn stage(operator: &TwoHostOperator, id: ComputerId) -> MoveStage {
    let moves = operator.repo.moves.lock().unwrap();
    moves
        .iter()
        .rev()
        .find(|moved| moved.computer_id == id)
        .map(|moved| moved.stage)
        .unwrap()
}

fn host_of(operator: &TwoHostOperator, id: ComputerId) -> HostId {
    operator.repo.computers.lock().unwrap()[&id].host
}

#[tokio::test]
async fn a_running_computer_moves_after_its_rounds_converge_and_commits_once_macrod_connects() {
    let operator = two_host_operator().await;
    let id = running_computer(&operator).await;

    let started = operator.start_move(id, MICROVM, "internal").await.unwrap();
    assert_eq!(started.from_host, HOST);
    assert_eq!(started.stage, MoveStage::Seeding);

    // Seed: the first round copies 8 GiB, so another round runs; the second
    // copies 10 MiB, which converges.
    operator.advance_moves().await.unwrap();
    operator.advance_moves().await.unwrap();
    assert_eq!(stage(&operator, id), MoveStage::Seeding);
    operator.advance_moves().await.unwrap();
    assert_eq!(stage(&operator, id), MoveStage::CuttingOver);
    assert_eq!(host_of(&operator, id), HOST);

    // Cutover: release, final round, adopt, flip.
    operator.advance_moves().await.unwrap();
    assert_eq!(stage(&operator, id), MoveStage::CuttingOver);
    operator.advance_moves().await.unwrap();
    assert_eq!(stage(&operator, id), MoveStage::Verifying);
    assert_eq!(host_of(&operator, id), MICROVM);
    assert_eq!(operator.fleet.home.logged(&format!("release {id}")), 1);
    assert_eq!(operator.fleet.home.logged(&format!("replicate {id}")), 3);
    assert_eq!(operator.fleet.microvm.logged(&format!("adopt {id}")), 1);
    {
        let computers = operator.repo.computers.lock().unwrap();
        assert_eq!(computers[&id].state.phase, Phase::Booting);
        assert!(!computers[&id].state.macrod_connected);
    }
    assert!(
        operator
            .repo
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|(computer, event)| *computer == id && *event == Event::Moved)
    );
    assert!(operator.repo.effects.lock().unwrap().iter().any(|pending| {
        pending.computer_id == id && pending.effect == Effect::Restart { host: MICROVM }
    }));

    // Not verified until macrod connects on the new host.
    operator.advance_moves().await.unwrap();
    assert_eq!(stage(&operator, id), MoveStage::Verifying);
    operator
        .repo
        .apply(id, Event::MacrodConnected, now())
        .await
        .unwrap();
    operator.advance_moves().await.unwrap();
    assert_eq!(stage(&operator, id), MoveStage::Committed);
    assert_eq!(operator.fleet.home.logged(&format!("drop_staged {id}")), 1);
    assert!(operator.repo.moves.lock().unwrap()[0].ticket.is_none());
    assert_eq!(operator.repo.open_moves().await.unwrap(), vec![]);
}

#[tokio::test]
async fn a_move_whose_macrod_never_connects_rolls_back_to_its_old_host() {
    let operator = two_host_operator().await;
    let id = running_computer(&operator).await;
    operator.start_move(id, MICROVM, "internal").await.unwrap();
    for _ in 0..5 {
        operator.advance_moves().await.unwrap();
    }
    assert_eq!(stage(&operator, id), MoveStage::Verifying);
    // The deadline passed.
    operator.repo.moves.lock().unwrap()[0].flipped_at =
        Some(now() - crate::domain::moves::VERIFY_DEADLINE - chrono::Duration::seconds(1));

    operator.advance_moves().await.unwrap();
    assert_eq!(stage(&operator, id), MoveStage::RollingBack);
    // Backwards: the new host releases, copies what it wrote, the old host
    // adopts, and the computer points at its old host again.
    operator.advance_moves().await.unwrap();
    operator.advance_moves().await.unwrap();
    assert_eq!(stage(&operator, id), MoveStage::RolledBack);
    assert_eq!(host_of(&operator, id), HOST);
    assert_eq!(operator.fleet.microvm.logged(&format!("release {id}")), 1);
    assert_eq!(operator.fleet.home.logged(&format!("adopt {id}")), 1);
    assert!(operator.repo.effects.lock().unwrap().iter().any(|pending| {
        pending.computer_id == id && pending.effect == Effect::Restart { host: HOST }
    }));
}

#[tokio::test]
async fn a_stopped_computer_commits_as_soon_as_it_is_adopted() {
    let operator = two_host_operator().await;
    let id = paid_computer(&operator).await;
    operator
        .repo
        .computers
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .state
        .phase = Phase::Stopped;
    operator.start_move(id, MICROVM, "internal").await.unwrap();
    for _ in 0..6 {
        operator.advance_moves().await.unwrap();
    }
    assert_eq!(stage(&operator, id), MoveStage::Committed);
    assert_eq!(host_of(&operator, id), MICROVM);
    assert_eq!(
        operator.repo.computers.lock().unwrap()[&id].state.phase,
        Phase::Stopped
    );
}

#[tokio::test]
async fn moves_that_cannot_happen_are_refused() {
    let operator = two_host_operator().await;
    let id = paid_computer(&operator).await;

    // Still being created.
    assert!(matches!(
        operator.start_move(id, MICROVM, "internal").await,
        Err(ComputerError::BadRequest(_))
    ));
    operator
        .repo
        .computers
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .state
        .phase = Phase::Running;
    assert!(matches!(
        operator.start_move(id, HOST, "internal").await,
        Err(ComputerError::BadRequest(_))
    ));
    operator.start_move(id, MICROVM, "internal").await.unwrap();
    assert!(matches!(
        operator.start_move(id, MICROVM, "internal").await,
        Err(ComputerError::BadRequest(_))
    ));
    assert!(matches!(
        operator
            .start_move(
                ComputerId::new_from_uuid(Uuid::from_u128(77)),
                MICROVM,
                "internal"
            )
            .await,
        Err(ComputerError::NotFound)
    ));
}

#[tokio::test]
async fn a_computer_held_by_a_cutover_is_neither_crashed_by_reconcile_nor_sent_effects() {
    let operator = two_host_operator().await;
    let id = running_computer(&operator).await;
    operator.start_move(id, MICROVM, "internal").await.unwrap();
    for _ in 0..3 {
        operator.advance_moves().await.unwrap();
    }
    assert_eq!(stage(&operator, id), MoveStage::CuttingOver);
    assert!(operator.repo.held(id).await.unwrap());

    // The home fleet lists no instance of it (it is staged): not a crash.
    operator.reconcile().await.unwrap();
    assert!(
        !operator
            .repo
            .events
            .lock()
            .unwrap()
            .iter()
            .any(|(computer, event)| *computer == id
                && matches!(event, Event::VmCrashed | Event::InstanceLost))
    );
}
