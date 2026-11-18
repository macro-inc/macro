//! The move pass: advances every open [`ComputerMove`] one step per pass,
//! through the source and target hosts' [`HostMoves`] (see
//! [`crate::domain::moves`]). Every step is safe to repeat: a pass that dies
//! halfway leaves the move where the next pass picks it up.

use tracing::Instrument;

use super::{ComputerOperator, internal};
use crate::domain::agent::ComputerAgents;
use crate::domain::ids::{ComputerId, HostId};
use crate::domain::lifecycle::Phase;
use crate::domain::models::Computer;
use crate::domain::moves::{
    ComputerMove, ComputerMoves, CopyStep, HostMoves, MoveStage, StartMoveError, TICKET_LIFETIME,
    VERIFY_DEADLINE, copy_step,
};
use crate::domain::ports::{ComputerRepo, Fleet, Fleets, Harnesses, SetupNotices};
use crate::domain::service::{Clock, ComputerError};

/// Which way a copy runs: the move itself, or its rollback.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Direction {
    Forward,
    Back,
}

impl<Repo, Machines, Registry, Time, SetupNotifier>
    ComputerOperator<Repo, Machines, Registry, Time, SetupNotifier>
where
    Repo: ComputerRepo + ComputerAgents + crate::domain::ports::OvercommitRepo + ComputerMoves,
    Machines: Fleets,
    Machines::Fleet: HostMoves,
    Registry: Harnesses,
    Time: Clock,
    SetupNotifier: SetupNotices,
{
    /// Start moving `computer_id` to `to_host` (an operator's request).
    #[tracing::instrument(name = "computer.move.start", skip(self, created_by), fields(%computer_id, %to_host, move_id = tracing::field::Empty), err)]
    pub async fn start_move(
        &self,
        computer_id: ComputerId,
        to_host: HostId,
        created_by: &str,
    ) -> Result<ComputerMove, ComputerError> {
        let computer = match self.repo.get(computer_id).await.map_err(internal)? {
            Some(record) => record.healthy().cloned().ok_or_else(|| {
                move_refused(StartMoveError::NotMovable(
                    "it needs an operator".to_owned(),
                ))
            })?,
            None => return Err(move_refused(StartMoveError::NotFound)),
        };
        if computer.host == to_host {
            return Err(move_refused(StartMoveError::SameHost));
        }
        match computer.state.phase {
            Phase::Provisioning { .. } => {
                return Err(move_refused(StartMoveError::NotMovable(
                    "it is still being created".to_owned(),
                )));
            }
            Phase::Destroying => {
                return Err(move_refused(StartMoveError::NotMovable(
                    "it was released".to_owned(),
                )));
            }
            Phase::Booting
            | Phase::Running
            | Phase::Crashed { .. }
            | Phase::Stopping
            | Phase::Stopped => {}
        }
        let target = self
            .fleet_for(to_host)
            .await
            .map_err(|error| move_refused(StartMoveError::BadTarget(error.to_string())))?;
        if target.move_address().await.map_err(internal)?.is_none() {
            return Err(move_refused(StartMoveError::BadTarget(
                "it has no move listener".to_owned(),
            )));
        }
        let units = computer.resources.units();
        let allocation = self.repo.allocation().await.map_err(internal)?;
        // A host that admits no purchases is absent here; an operator may
        // still fill it with moves.
        if let Some(target) = allocation.iter().find(|host| host.host.id == to_host)
            && !target.sells(units)
        {
            return Err(move_refused(StartMoveError::NoRoom));
        }
        let created = self
            .repo
            .create_move(computer_id, computer.host, to_host, created_by)
            .await
            .map_err(internal)?
            .map_err(move_refused)?;
        tracing::Span::current().record("move_id", tracing::field::display(created.id));
        Ok(created)
    }

    /// A computer's moves, newest first.
    pub async fn moves_of(
        &self,
        computer_id: ComputerId,
    ) -> Result<Vec<ComputerMove>, ComputerError> {
        self.repo.moves_of(computer_id).await.map_err(internal)
    }

    /// Advance every open move one step; returns how many are open. One
    /// failing move records its error and skips only itself.
    pub async fn advance_moves(&self) -> Result<usize, ComputerError> {
        let moves = self.repo.open_moves().await.map_err(internal)?;
        let open = moves.len();
        for moved in moves {
            let span = tracing::info_span!(
                "computer.move.advance",
                move_id = %moved.id,
                computer_id = %moved.computer_id,
                from_host = %moved.from_host,
                to_host = %moved.to_host,
                stage = moved.stage.as_ref(),
                next_stage = tracing::field::Empty,
                otel.status_code = tracing::field::Empty,
            );
            let mut moved = moved;
            let before = moved.stage;
            let outcome = self.advance(&mut moved).instrument(span.clone()).await;
            span.record("next_stage", moved.stage.as_ref());
            match outcome {
                Ok(()) => {
                    if moved.stage != before || moved.error.is_some() {
                        moved.error = None;
                    }
                }
                Err(error) => {
                    span.record("otel.status_code", "ERROR");
                    tracing::warn!(parent: &span, error = ?error, "computer move step failed; retrying next pass");
                    moved.error = Some(error.to_string());
                }
            }
            self.repo
                .update_move(&moved, self.clock.now())
                .await
                .map_err(internal)?;
        }
        Ok(open)
    }

    async fn advance(&self, moved: &mut ComputerMove) -> Result<(), ComputerError> {
        let computer = match self.repo.get(moved.computer_id).await.map_err(internal)? {
            Some(record) => record.healthy().cloned(),
            None => None,
        };
        let Some(computer) = computer.filter(|computer| computer.state.phase != Phase::Destroying)
        else {
            // Released while moving: nothing to move. Whatever the target
            // received goes; the release destroys the rest.
            self.fleet_for(moved.to_host)
                .await?
                .drop_staged(moved.computer_id)
                .await
                .map_err(internal)?;
            moved.stage = MoveStage::Failed;
            moved.error = Some("the computer was released".to_owned());
            return Ok(());
        };
        match moved.stage {
            MoveStage::Seeding => self.copy(moved, &computer, Direction::Forward, false).await,
            MoveStage::CuttingOver => self.copy(moved, &computer, Direction::Forward, true).await,
            MoveStage::RollingBack => self.copy(moved, &computer, Direction::Back, true).await,
            MoveStage::Verifying => self.verify(moved, &computer).await,
            MoveStage::Committed | MoveStage::RolledBack | MoveStage::Failed => Ok(()),
        }
    }

    /// One step of copying from the source to the target of `direction`;
    /// `final_round` once the source has to release the computer first.
    async fn copy(
        &self,
        moved: &mut ComputerMove,
        computer: &Computer,
        direction: Direction,
        final_round: bool,
    ) -> Result<(), ComputerError> {
        let (from, to) = match direction {
            Direction::Forward => (moved.from_host, moved.to_host),
            Direction::Back => (moved.to_host, moved.from_host),
        };
        let ticket = moved.ticket.clone().ok_or_else(|| {
            ComputerError::Internal(rootcause::report!("open move without a ticket"))
        })?;
        let source = self.fleet_for(from).await?;
        let target = self.fleet_for(to).await?;
        target
            .expect_move(
                moved.computer_id,
                &ticket,
                self.clock.now() + TICKET_LIFETIME,
            )
            .await
            .map_err(internal)?;
        if final_round {
            source.release(moved.computer_id).await.map_err(internal)?;
        }
        let round = source
            .replication(moved.computer_id)
            .await
            .map_err(internal)?;
        match copy_step(&round, final_round, moved.rounds) {
            CopyStep::Wait => Ok(()),
            CopyStep::Replicate => {
                if round.state == crate::domain::moves::RoundState::Done {
                    moved.last_round_bytes = Some(round.bytes);
                }
                let address = target
                    .move_address()
                    .await
                    .map_err(internal)?
                    .ok_or_else(|| {
                        ComputerError::Internal(rootcause::report!(
                            "host {to} has no move listener"
                        ))
                    })?;
                source
                    .replicate(moved.computer_id, &address, &ticket)
                    .await
                    .map_err(internal)?;
                if !final_round {
                    moved.rounds += 1;
                }
                Ok(())
            }
            CopyStep::CutOver => {
                moved.last_round_bytes = Some(round.bytes);
                moved.was_running = Some(matches!(
                    computer.state.phase,
                    Phase::Running | Phase::Booting
                ));
                moved.stage = MoveStage::CuttingOver;
                tracing::info!(
                    rounds = moved.rounds,
                    last_round_bytes = round.bytes,
                    "computer move converged; cutting over"
                );
                Ok(())
            }
            CopyStep::Adopt => {
                moved.last_round_bytes = Some(round.bytes);
                target
                    .adopt(
                        moved.computer_id,
                        source.control_plane_id(),
                        computer.enrollment_generation,
                    )
                    .await
                    .map_err(internal)?;
                let stage = match direction {
                    Direction::Forward => MoveStage::Verifying,
                    Direction::Back => MoveStage::RolledBack,
                };
                let now = self.clock.now();
                self.repo
                    .flip(moved, to, stage, now)
                    .await
                    .map_err(internal)?;
                moved.stage = stage;
                moved.flipped_at = Some(now);
                tracing::info!(host_id = %to, "computer moved to its new host");
                Ok(())
            }
        }
    }

    /// After the flip: macrod connected on the new host commits the move
    /// (and drops the source's copy); past the deadline it rolls back.
    async fn verify(
        &self,
        moved: &mut ComputerMove,
        computer: &Computer,
    ) -> Result<(), ComputerError> {
        let ran = moved.was_running.unwrap_or(false);
        let connected = computer.state.macrod_connected && computer.state.phase == Phase::Running;
        if !ran || connected {
            self.fleet_for(moved.from_host)
                .await?
                .drop_staged(moved.computer_id)
                .await
                .map_err(internal)?;
            moved.stage = MoveStage::Committed;
            tracing::info!(was_running = ran, "computer move committed");
            return Ok(());
        }
        let flipped = moved.flipped_at.unwrap_or(moved.created_at);
        if self.clock.now() - flipped > VERIFY_DEADLINE {
            tracing::warn!("macrod did not connect on the new host; rolling the move back");
            moved.stage = MoveStage::RollingBack;
        }
        Ok(())
    }
}

fn move_refused(error: StartMoveError) -> ComputerError {
    match error {
        StartMoveError::NotFound => ComputerError::NotFound,
        error => ComputerError::BadRequest(error.to_string()),
    }
}
