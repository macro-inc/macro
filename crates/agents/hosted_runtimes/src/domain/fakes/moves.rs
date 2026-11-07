//! [`ComputerMoves`] for [`FakeRepo`]: moves in memory, flips through the
//! fake's own lifecycle applier, as the Postgres one does in a transaction.

use std::collections::HashSet;

use chrono::{DateTime, Utc};

use super::{FakeError, FakeRepo};
use crate::domain::ids::{ComputerId, HostId};
use crate::domain::lifecycle::Event;
use crate::domain::moves::{
    ComputerMove, ComputerMoves, MoveId, MoveStage, MoveTicket, StartMoveError,
};
use crate::domain::ports::ComputerRepo;

impl ComputerMoves for FakeRepo {
    type Err = FakeError;

    async fn create_move(
        &self,
        computer_id: ComputerId,
        from_host: HostId,
        to_host: HostId,
        created_by: &str,
    ) -> Result<Result<ComputerMove, StartMoveError>, FakeError> {
        let mut moves = self.moves.lock().unwrap();
        if moves
            .iter()
            .any(|moved| moved.computer_id == computer_id && moved.stage.is_open())
        {
            return Ok(Err(StartMoveError::AlreadyMoving));
        }
        let created = ComputerMove {
            id: MoveId::generate(),
            computer_id,
            from_host,
            to_host,
            stage: MoveStage::Seeding,
            ticket: Some(MoveTicket::new(format!("ticket-{}", moves.len()))),
            rounds: 0,
            last_round_bytes: None,
            was_running: None,
            flipped_at: None,
            error: None,
            created_by: created_by.to_owned(),
            created_at: super::now(),
        };
        moves.push(created.clone());
        Ok(Ok(created))
    }

    async fn open_moves(&self) -> Result<Vec<ComputerMove>, FakeError> {
        Ok(self
            .moves
            .lock()
            .unwrap()
            .iter()
            .filter(|moved| moved.stage.is_open())
            .cloned()
            .collect())
    }

    async fn moves_of(&self, computer_id: ComputerId) -> Result<Vec<ComputerMove>, FakeError> {
        Ok(self
            .moves
            .lock()
            .unwrap()
            .iter()
            .rev()
            .filter(|moved| moved.computer_id == computer_id)
            .cloned()
            .collect())
    }

    async fn update_move(
        &self,
        moved: &ComputerMove,
        _now: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        let mut moves = self.moves.lock().unwrap();
        if let Some(stored) = moves.iter_mut().find(|stored| stored.id == moved.id) {
            *stored = moved.clone();
            if !stored.stage.is_open() {
                stored.ticket = None;
            }
        }
        Ok(())
    }

    async fn flip(
        &self,
        moved: &ComputerMove,
        host: HostId,
        stage: MoveStage,
        now: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        if let Some(computer) = self.computers.lock().unwrap().get_mut(&moved.computer_id) {
            computer.host = host;
        }
        self.apply(moved.computer_id, Event::Moved, now).await?;
        let mut moves = self.moves.lock().unwrap();
        if let Some(stored) = moves.iter_mut().find(|stored| stored.id == moved.id) {
            stored.stage = stage;
            stored.flipped_at = Some(now);
        }
        Ok(())
    }

    async fn held_on(&self, host: HostId) -> Result<HashSet<ComputerId>, FakeError> {
        Ok(self
            .moves
            .lock()
            .unwrap()
            .iter()
            .filter(|moved| {
                moved.stage.holds_computer() && (moved.from_host == host || moved.to_host == host)
            })
            .map(|moved| moved.computer_id)
            .collect())
    }

    async fn held(&self, computer_id: ComputerId) -> Result<bool, FakeError> {
        Ok(self
            .moves
            .lock()
            .unwrap()
            .iter()
            .any(|moved| moved.computer_id == computer_id && moved.stage.holds_computer()))
    }

    async fn postpone_effect(
        &self,
        effect_id: i64,
        run_after: DateTime<Utc>,
    ) -> Result<(), FakeError> {
        self.effect_run_after
            .lock()
            .unwrap()
            .insert(effect_id, run_after);
        Ok(())
    }
}
