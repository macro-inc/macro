//! [`ComputerMoves`] in `computer_move`.

use std::collections::HashSet;

use super::*;
use crate::domain::moves::{
    ComputerMove, ComputerMoves, MoveId, MoveStage, MoveTicket, StartMoveError,
};

struct MoveRow {
    id: Uuid,
    computer_id: Uuid,
    from_host: Uuid,
    to_host: Uuid,
    stage: MoveStage,
    ticket: Option<String>,
    rounds: i32,
    last_round_bytes: Option<i64>,
    was_running: Option<bool>,
    flipped_at: Option<DateTime<Utc>>,
    error: Option<String>,
    created_by: String,
    created_at: DateTime<Utc>,
}

impl TryFrom<MoveRow> for ComputerMove {
    type Error = PgComputerError;

    fn try_from(row: MoveRow) -> Result<Self, PgComputerError> {
        Ok(Self {
            id: MoveId::new(row.id),
            computer_id: ComputerId::new_from_uuid(row.computer_id),
            from_host: HostId::new(row.from_host),
            to_host: HostId::new(row.to_host),
            stage: row.stage,
            ticket: row.ticket.map(MoveTicket::new),
            rounds: u32::try_from(row.rounds)?,
            last_round_bytes: row.last_round_bytes.map(u64::try_from).transpose()?,
            was_running: row.was_running,
            flipped_at: row.flipped_at,
            error: row.error,
            created_by: row.created_by,
            created_at: row.created_at,
        })
    }
}

impl ComputerMoves for PgComputerRepo {
    type Err = PgComputerError;

    #[tracing::instrument(name = "computer.move.create", skip(self, created_by), err)]
    async fn create_move(
        &self,
        computer_id: ComputerId,
        from_host: HostId,
        to_host: HostId,
        created_by: &str,
    ) -> Result<Result<ComputerMove, StartMoveError>, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        // The computer's row lock orders this against a concurrent release
        // and a second move.
        let current = sqlx::query_scalar!(
            "SELECT host_id FROM hosted_runtime WHERE id = $1 FOR UPDATE",
            computer_id.as_uuid(),
        )
        .fetch_optional(&mut *tx)
        .await?;
        match current {
            None => return Ok(Err(StartMoveError::NotFound)),
            Some(host) if host != from_host.into_inner() => {
                return Ok(Err(StartMoveError::NotMovable(
                    "its host changed meanwhile".to_owned(),
                )));
            }
            Some(_) => {}
        }
        // The ticket is 244 random bits (two v4 UUIDs, which are random by
        // construction); it is a one-time secret, not an id.
        let row = sqlx::query_as!(
            MoveRow,
            r#"
            INSERT INTO computer_move (id, computer_id, from_host, to_host, stage, ticket, created_by)
            VALUES ($1, $2, $3, $4, 'seeding',
                    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), $5)
            ON CONFLICT (computer_id)
                WHERE stage IN ('seeding', 'cutting_over', 'verifying', 'rolling_back')
                DO NOTHING
            RETURNING id, computer_id, from_host, to_host, stage AS "stage: MoveStage", ticket,
                      rounds, last_round_bytes, was_running, flipped_at, error, created_by, created_at
            "#,
            MoveId::generate().into_inner(),
            computer_id.as_uuid(),
            from_host.into_inner(),
            to_host.into_inner(),
            created_by,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            return Ok(Err(StartMoveError::AlreadyMoving));
        };
        tx.commit().await?;
        Ok(Ok(ComputerMove::try_from(row)?))
    }

    async fn open_moves(&self) -> Result<Vec<ComputerMove>, PgComputerError> {
        sqlx::query_as!(
            MoveRow,
            r#"
            SELECT id, computer_id, from_host, to_host, stage AS "stage: MoveStage", ticket,
                   rounds, last_round_bytes, was_running, flipped_at, error, created_by, created_at
            FROM computer_move
            WHERE stage IN ('seeding', 'cutting_over', 'verifying', 'rolling_back')
            ORDER BY created_at
            "#,
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(ComputerMove::try_from)
        .collect()
    }

    async fn moves_of(
        &self,
        computer_id: ComputerId,
    ) -> Result<Vec<ComputerMove>, PgComputerError> {
        sqlx::query_as!(
            MoveRow,
            r#"
            SELECT id, computer_id, from_host, to_host, stage AS "stage: MoveStage", ticket,
                   rounds, last_round_bytes, was_running, flipped_at, error, created_by, created_at
            FROM computer_move
            WHERE computer_id = $1
            ORDER BY created_at DESC
            LIMIT 50
            "#,
            computer_id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(ComputerMove::try_from)
        .collect()
    }

    async fn update_move(
        &self,
        moved: &ComputerMove,
        now: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        let finished = !moved.stage.is_open();
        sqlx::query!(
            r#"
            UPDATE computer_move
            SET stage = $2, rounds = $3, last_round_bytes = $4, was_running = $5, error = $6,
                updated_at = $7,
                ticket = CASE WHEN $8 THEN NULL ELSE ticket END,
                finished_at = CASE WHEN $8 THEN $7 ELSE finished_at END
            WHERE id = $1
            "#,
            moved.id.into_inner(),
            moved.stage as MoveStage,
            i32::try_from(moved.rounds)?,
            moved.last_round_bytes.map(i64::try_from).transpose()?,
            moved.was_running,
            moved.error.as_deref(),
            now,
            finished,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(name = "computer.move.flip", skip(self, moved), fields(move_id = %moved.id, computer_id = %moved.computer_id, %host, stage = stage.as_ref()), err)]
    async fn flip(
        &self,
        moved: &ComputerMove,
        host: HostId,
        stage: MoveStage,
        now: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        let mut tx = self.pool.begin().await?;
        // Both hosts, in id order, before the computer: purchases and
        // effect leases lock host rows too.
        sqlx::query!(
            r#"
            SELECT host.id FROM hosted_runtime_host host
            WHERE host.id = $2
               OR host.id = (SELECT host_id FROM hosted_runtime WHERE id = $1)
            ORDER BY host.id
            FOR UPDATE
            "#,
            moved.computer_id.as_uuid(),
            host.into_inner(),
        )
        .fetch_all(&mut *tx)
        .await?;
        sqlx::query!(
            "UPDATE hosted_runtime SET host_id = $2, updated_at = $3 WHERE id = $1",
            moved.computer_id.as_uuid(),
            host.into_inner(),
            now,
        )
        .execute(&mut *tx)
        .await?;
        Self::apply_locked(&mut tx, moved.computer_id, &Event::Moved, now, self.policy).await?;
        sqlx::query!(
            "UPDATE computer_move SET stage = $2, flipped_at = $3, updated_at = $3 WHERE id = $1",
            moved.id.into_inner(),
            stage as MoveStage,
            now,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn held_on(&self, host: HostId) -> Result<HashSet<ComputerId>, PgComputerError> {
        Ok(sqlx::query_scalar!(
            r#"
            SELECT computer_id FROM computer_move
            WHERE stage IN ('cutting_over', 'rolling_back') AND (from_host = $1 OR to_host = $1)
            "#,
            host.into_inner(),
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(ComputerId::new_from_uuid)
        .collect())
    }

    async fn held(&self, computer_id: ComputerId) -> Result<bool, PgComputerError> {
        Ok(sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1 FROM computer_move
                WHERE computer_id = $1 AND stage IN ('cutting_over', 'rolling_back')
            ) AS "held!"
            "#,
            computer_id.as_uuid(),
        )
        .fetch_one(&self.pool)
        .await?)
    }

    async fn postpone_effect(
        &self,
        effect_id: i64,
        run_after: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            "UPDATE hosted_runtime_effect SET run_after = $2 WHERE id = $1",
            effect_id,
            run_after,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
