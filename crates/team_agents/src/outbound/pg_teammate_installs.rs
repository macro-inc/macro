//! Postgres adapter for agents' installs on their owners' own machines, and
//! the machines' hosting reports. agent_harness_service uses the inherent
//! methods for delivery; authentication_service the port.

use agent_runtime_protocol::domain::schema::v0::TeammateHostReport;
use chrono::{DateTime, Utc};
use harness_id::HarnessId;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::domain::models::TeamAgentError;
use crate::domain::ports::{CountedDelivery, TeammateInstalls};
use crate::domain::self_hosting::{
    Checkpoint, CreatedInstall, HostFacts, InstallFailure, InstallRunState, NewTeammateInstall,
    TeammateInstallRecord,
};

#[cfg(test)]
mod test;

/// A stored install row is malformed; the values are not repeated.
#[derive(Debug, thiserror::Error)]
#[error("a stored teammate install is malformed: {0}")]
struct MalformedInstall(&'static str);

/// Installs and hosting reports in MacroDB.
#[derive(Clone)]
pub struct PgTeammateInstalls {
    pool: PgPool,
}

impl PgTeammateInstalls {
    /// Build the adapter on a pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct InstallRow {
    install_id: Uuid,
    agent_user_id: String,
    team_id: Uuid,
    harness_id: Uuid,
    generation: i64,
    run_state: String,
    failure: Option<String>,
    delivery: i64,
    applied_generation: Option<i64>,
    applied_delivery: Option<i64>,
    checkpoint: Option<String>,
    move_to_harness_id: Option<Uuid>,
    checkpoint_started_at: Option<DateTime<Utc>>,
    delivered_image_id: Option<String>,
}

fn generation(value: i64) -> Result<u64, TeamAgentError> {
    u64::try_from(value).map_err(|_| TeamAgentError::internal(MalformedInstall("generation")))
}

fn stored_generation(value: u64) -> Result<i64, TeamAgentError> {
    i64::try_from(value).map_err(|_| TeamAgentError::internal(MalformedInstall("generation")))
}

impl TryFrom<InstallRow> for TeammateInstallRecord {
    type Error = TeamAgentError;

    fn try_from(row: InstallRow) -> Result<Self, Self::Error> {
        let malformed = |what| TeamAgentError::internal(MalformedInstall(what));
        let checkpoint = match (
            row.checkpoint.as_deref(),
            row.move_to_harness_id,
            row.checkpoint_started_at,
        ) {
            (None, _, _) => None,
            (Some("moving"), Some(to), Some(since)) => Some((
                Checkpoint::Moving {
                    to: HarnessId::new_from_uuid(to),
                },
                since,
            )),
            (Some("removing"), _, Some(since)) => Some((Checkpoint::Removing, since)),
            _ => return Err(malformed("checkpoint")),
        };
        Ok(Self {
            install_id: row.install_id,
            agent: MacroUserIdStr::parse_from_str(&row.agent_user_id)
                .map(MacroUserIdStr::into_owned)
                .map_err(|_| malformed("agent"))?,
            team_id: row.team_id,
            harness_id: HarnessId::new_from_uuid(row.harness_id),
            generation: generation(row.generation)?,
            run_state: row
                .run_state
                .parse::<InstallRunState>()
                .map_err(|_| malformed("run_state"))?,
            failure: row
                .failure
                .map(|failure| failure.parse::<InstallFailure>())
                .transpose()
                .map_err(|_| malformed("failure"))?,
            delivery: generation(row.delivery)?,
            applied: match (row.applied_generation, row.applied_delivery) {
                (Some(applied_generation), Some(applied_delivery)) => Some((
                    generation(applied_generation)?,
                    generation(applied_delivery)?,
                )),
                _ => None,
            },
            checkpoint,
            image_id: row.delivered_image_id,
        })
    }
}

struct HostRow {
    id: Uuid,
    name: String,
    last_connected_at: Option<DateTime<Utc>>,
    last_disconnected_at: Option<DateTime<Utc>>,
    has_live_connection: bool,
    has_connection_record: bool,
    report: Option<serde_json::Value>,
}

impl From<HostRow> for HostFacts {
    fn from(row: HostRow) -> Self {
        // As harnesses decides it: a live connection row is the answer; a
        // lapsed one means its replica died; with none, an older replica
        // only stamped the timestamps.
        let connected = row.has_live_connection
            || (!row.has_connection_record
                && match (row.last_connected_at, row.last_disconnected_at) {
                    (Some(connected_at), Some(disconnected_at)) => connected_at > disconnected_at,
                    (Some(_), None) => true,
                    (None, _) => false,
                });
        let report = row.report.and_then(|report| {
            serde_json::from_value::<TeammateHostReport>(report)
                .inspect_err(|error| {
                    tracing::warn!(error = %error, harness_id = %row.id, "ignoring a stored hosting report of an older shape");
                })
                .ok()
        });
        Self {
            harness_id: HarnessId::new_from_uuid(row.id),
            name: row.name,
            connected,
            report,
        }
    }
}

fn checkpoint_columns(checkpoint: Checkpoint) -> (&'static str, Option<Uuid>) {
    match checkpoint {
        Checkpoint::Moving { to } => ("moving", Some(to.as_uuid())),
        Checkpoint::Removing => ("removing", None),
    }
}

/// A counted delivery: its transaction holds the install row's lock.
pub struct PgCountedDelivery {
    transaction: Transaction<'static, Postgres>,
    pair: (u64, u64),
}

impl CountedDelivery for PgCountedDelivery {
    fn pair(&self) -> (u64, u64) {
        self.pair
    }

    async fn release(self) -> Result<(), TeamAgentError> {
        self.transaction
            .commit()
            .await
            .map_err(TeamAgentError::internal)
    }
}

impl TeammateInstalls for PgTeammateInstalls {
    type Delivery = PgCountedDelivery;

    #[tracing::instrument(skip_all, fields(install_id = %install.install_id), err)]
    async fn create(&self, install: &NewTeammateInstall) -> Result<CreatedInstall, TeamAgentError> {
        // Waits for a concurrent insert for the same agent, then skips the
        // row if that one committed: one install per agent.
        let created = sqlx::query_as!(
            InstallRow,
            r#"
            INSERT INTO team_agent_installs
                (agent_user_id, install_id, team_id, harness_id, generation, created_by)
            VALUES ($1, $2, $3, $4, 1, $5)
            ON CONFLICT (agent_user_id) DO NOTHING
            RETURNING install_id, agent_user_id, team_id, harness_id, generation, run_state,
                      failure, delivery, applied_generation, applied_delivery, checkpoint,
                      move_to_harness_id,
                      checkpoint_started_at, delivered_image_id
            "#,
            install.agent.as_ref(),
            install.install_id,
            install.team_id,
            install.harness_id.as_uuid(),
            install.created_by.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?;
        if let Some(row) = created {
            return Ok(CreatedInstall::Created(row.try_into()?));
        }

        let existing = self
            .for_agent(&install.agent)
            .await?
            // Removed in between; the caller may try again.
            .ok_or_else(|| TeamAgentError::internal(MalformedInstall("vanished")))?;
        Ok(CreatedInstall::AlreadyInstalled(existing))
    }

    #[tracing::instrument(skip_all, err)]
    async fn for_agent(
        &self,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<Option<TeammateInstallRecord>, TeamAgentError> {
        sqlx::query_as!(
            InstallRow,
            r#"
            SELECT install_id, agent_user_id, team_id, harness_id, generation, run_state,
                   failure, delivery, applied_generation, applied_delivery, checkpoint,
                      move_to_harness_id,
                   checkpoint_started_at, delivered_image_id
            FROM team_agent_installs
            WHERE agent_user_id = $1
            "#,
            agent.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?
        .map(TeammateInstallRecord::try_from)
        .transpose()
    }

    #[tracing::instrument(skip_all, fields(agents = agents.len()), err)]
    async fn for_agents(
        &self,
        agents: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<TeammateInstallRecord>, TeamAgentError> {
        let agents: Vec<&str> = agents.iter().map(|agent| agent.as_ref()).collect();
        sqlx::query_as!(
            InstallRow,
            r#"
            SELECT install_id, agent_user_id, team_id, harness_id, generation, run_state,
                   failure, delivery, applied_generation, applied_delivery, checkpoint,
                   move_to_harness_id,
                   checkpoint_started_at, delivered_image_id
            FROM team_agent_installs
            WHERE agent_user_id = ANY($1::TEXT[])
            "#,
            &agents as &[&str],
        )
        .fetch_all(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?
        .into_iter()
        .map(TeammateInstallRecord::try_from)
        .collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn by_id(
        &self,
        install_id: Uuid,
    ) -> Result<Option<TeammateInstallRecord>, TeamAgentError> {
        sqlx::query_as!(
            InstallRow,
            r#"
            SELECT install_id, agent_user_id, team_id, harness_id, generation, run_state,
                   failure, delivery, applied_generation, applied_delivery, checkpoint,
                      move_to_harness_id,
                   checkpoint_started_at, delivered_image_id
            FROM team_agent_installs
            WHERE install_id = $1
            "#,
            install_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?
        .map(TeammateInstallRecord::try_from)
        .transpose()
    }

    #[tracing::instrument(skip(self, agent), err)]
    async fn begin_checkpoint(
        &self,
        agent: &MacroUserIdStr<'_>,
        checkpoint: Checkpoint,
    ) -> Result<Option<TeammateInstallRecord>, TeamAgentError> {
        let (kind, move_to) = checkpoint_columns(checkpoint);
        // A removal is never turned back into a move.
        sqlx::query_as!(
            InstallRow,
            r#"
            UPDATE team_agent_installs
            SET checkpoint = $2,
                move_to_harness_id = $3,
                checkpoint_started_at = COALESCE(checkpoint_started_at, now()),
                updated_at = now()
            WHERE agent_user_id = $1
              AND (checkpoint IS DISTINCT FROM 'removing' OR $2 = 'removing')
            RETURNING install_id, agent_user_id, team_id, harness_id, generation, run_state,
                      failure, delivery, applied_generation, applied_delivery, checkpoint,
                      move_to_harness_id,
                      checkpoint_started_at, delivered_image_id
            "#,
            agent.as_ref(),
            kind,
            move_to,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?
        .map(TeammateInstallRecord::try_from)
        .transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn finish_move(
        &self,
        install_id: Uuid,
        new_install_id: Uuid,
    ) -> Result<Option<TeammateInstallRecord>, TeamAgentError> {
        sqlx::query_as!(
            InstallRow,
            r#"
            UPDATE team_agent_installs
            SET install_id = $2,
                harness_id = move_to_harness_id,
                generation = generation + 1,
                delivery = 0,
                reported_delivery = NULL,
                applied_generation = NULL,
                applied_delivery = NULL,
                run_state = 'pending',
                failure = NULL,
                checkpoint = NULL,
                move_to_harness_id = NULL,
                checkpoint_started_at = NULL,
                updated_at = now()
            WHERE install_id = $1 AND checkpoint = 'moving'
            RETURNING install_id, agent_user_id, team_id, harness_id, generation, run_state,
                      failure, delivery, applied_generation, applied_delivery, checkpoint,
                      move_to_harness_id,
                      checkpoint_started_at, delivered_image_id
            "#,
            install_id,
            new_install_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?
        .map(TeammateInstallRecord::try_from)
        .transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn next_delivery(
        &self,
        install_id: Uuid,
        harness: HarnessId,
        reported: (u64, u64),
        image_id: &str,
    ) -> Result<Option<PgCountedDelivery>, TeamAgentError> {
        // The update's row lock lasts until the delivery is released: a
        // racing replica waits, then rechecks and counts its own delivery.
        let mut transaction = self.pool.begin().await.map_err(TeamAgentError::internal)?;
        let counted = sqlx::query!(
            r#"
            UPDATE team_agent_installs
            SET delivery = delivery + 1, delivered_image_id = $5, updated_at = now()
            WHERE install_id = $1
              AND harness_id = $2
              AND checkpoint IS NULL
              AND (generation, delivery) > ($3::BIGINT, $4::BIGINT)
            RETURNING generation, delivery
            "#,
            install_id,
            harness.as_uuid(),
            stored_generation(reported.0)?,
            stored_generation(reported.1)?,
            image_id,
        )
        .fetch_optional(&mut *transaction)
        .await
        .map_err(TeamAgentError::internal)?;
        let Some(row) = counted else {
            return Ok(None);
        };
        Ok(Some(PgCountedDelivery {
            pair: (generation(row.generation)?, generation(row.delivery)?),
            transaction,
        }))
    }

    #[tracing::instrument(skip_all, err)]
    async fn hosts_of(&self, owner: &MacroUserIdStr<'_>) -> Result<Vec<HostFacts>, TeamAgentError> {
        let rows = sqlx::query_as!(
            HostRow,
            r#"
            SELECT h.id, h.name, h.last_connected_at, h.last_disconnected_at,
                   EXISTS (
                       SELECT 1 FROM harness_runtime_connection c
                       WHERE c.harness_id = h.id AND c.lease_expires_at > now()
                   ) AS "has_live_connection!",
                   EXISTS (
                       SELECT 1 FROM harness_runtime_connection c WHERE c.harness_id = h.id
                   ) AS "has_connection_record!",
                   t.report AS "report?"
            FROM harnesses h
            LEFT JOIN harness_teammate_hosts t ON t.harness_id = h.id
            WHERE h.owner_user_id = $1 AND h.deleted_at IS NULL AND h.computer_id IS NULL
            ORDER BY h.name, h.id
            "#,
            owner.as_ref(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?;
        Ok(rows.into_iter().map(HostFacts::from).collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn host(&self, harness: HarnessId) -> Result<Option<HostFacts>, TeamAgentError> {
        let row = sqlx::query_as!(
            HostRow,
            r#"
            SELECT h.id, h.name, h.last_connected_at, h.last_disconnected_at,
                   EXISTS (
                       SELECT 1 FROM harness_runtime_connection c
                       WHERE c.harness_id = h.id AND c.lease_expires_at > now()
                   ) AS "has_live_connection!",
                   EXISTS (
                       SELECT 1 FROM harness_runtime_connection c WHERE c.harness_id = h.id
                   ) AS "has_connection_record!",
                   t.report AS "report?"
            FROM harnesses h
            LEFT JOIN harness_teammate_hosts t ON t.harness_id = h.id
            WHERE h.id = $1 AND h.deleted_at IS NULL
            "#,
            harness.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?;
        Ok(row.map(HostFacts::from))
    }

    #[tracing::instrument(skip(self), err)]
    async fn host_entitled(
        &self,
        harness: HarnessId,
        team_id: Uuid,
    ) -> Result<bool, TeamAgentError> {
        sqlx::query_scalar!(
            r#"
            SELECT EXISTS (
                SELECT 1
                FROM harnesses h
                JOIN team t ON t.id = $2
                WHERE h.id = $1
                  AND h.deleted_at IS NULL
                  AND h.computer_id IS NULL
                  AND (
                      t.owner_id = h.owner_user_id
                      OR EXISTS (
                          SELECT 1 FROM team_user tu
                          WHERE tu.user_id = h.owner_user_id
                            AND tu.team_id = $2
                            AND tu.team_role IN ('owner', 'admin')
                      )
                  )
            ) AS "entitled!"
            "#,
            harness.as_uuid(),
            team_id,
        )
        .fetch_one(&self.pool)
        .await
        .map_err(TeamAgentError::internal)
    }

    #[tracing::instrument(skip(self), err)]
    async fn unentitled_installs(
        &self,
        limit: u32,
    ) -> Result<Vec<TeammateInstallRecord>, TeamAgentError> {
        // A whole-table read of a small table: one row per own-machine agent.
        let rows = sqlx::query_as!(
            InstallRow,
            r#"
            SELECT i.install_id, i.agent_user_id, i.team_id, i.harness_id, i.generation,
                   i.run_state, i.failure, i.delivery, i.applied_generation, i.applied_delivery,
                   i.checkpoint, i.move_to_harness_id, i.checkpoint_started_at,
                   i.delivered_image_id
            FROM team_agent_installs i
            JOIN team t ON t.id = i.team_id
            WHERE i.checkpoint IS DISTINCT FROM 'removing'
              AND EXISTS (
                  SELECT 1
                  FROM harnesses h
                  WHERE h.id IN (i.harness_id, i.move_to_harness_id)
                    AND (
                        h.deleted_at IS NOT NULL
                        OR h.owner_user_id IS NULL
                        OR (
                            h.owner_user_id IS DISTINCT FROM t.owner_id
                            AND NOT EXISTS (
                                SELECT 1 FROM team_user tu
                                WHERE tu.user_id = h.owner_user_id
                                  AND tu.team_id = i.team_id
                                  AND tu.team_role IN ('owner', 'admin')
                            )
                        )
                    )
              )
            ORDER BY i.install_id
            LIMIT $1
            "#,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?;
        rows.into_iter()
            .map(TeammateInstallRecord::try_from)
            .collect()
    }
}

/// Delivery's side, for the replica holding a machine's socket.
impl PgTeammateInstalls {
    /// The installs that run on `harness` or are leaving it.
    #[tracing::instrument(skip(self), err)]
    pub async fn installs_on(
        &self,
        harness: HarnessId,
    ) -> Result<Vec<TeammateInstallRecord>, TeamAgentError> {
        let rows = sqlx::query_as!(
            InstallRow,
            r#"
            SELECT install_id, agent_user_id, team_id, harness_id, generation, run_state,
                   failure, delivery, applied_generation, applied_delivery, checkpoint,
                      move_to_harness_id,
                   checkpoint_started_at, delivered_image_id
            FROM team_agent_installs
            WHERE harness_id = $1
            ORDER BY install_id
            "#,
            harness.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?;
        rows.into_iter()
            .map(TeammateInstallRecord::try_from)
            .collect()
    }

    /// Keep `report` as the machine's latest hosting report.
    #[tracing::instrument(skip(self, report), err)]
    pub async fn save_host_report(
        &self,
        harness: HarnessId,
        report: &TeammateHostReport,
    ) -> Result<(), TeamAgentError> {
        sqlx::query!(
            r#"
            INSERT INTO harness_teammate_hosts (harness_id, report, reported_at)
            VALUES ($1, $2, now())
            ON CONFLICT (harness_id) DO UPDATE
            SET report = EXCLUDED.report, reported_at = EXCLUDED.reported_at
            "#,
            harness.as_uuid(),
            sqlx::types::Json(report) as _,
        )
        .execute(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?;
        Ok(())
    }

    /// Give `install_id` its next generation (new keys, nothing delivered
    /// yet) when its latest delivery carried another image than `image_id`
    /// and it is still at `generation`. The updated install, or `None` when
    /// nothing changed (already bumped, never delivered, or checkpointing).
    #[tracing::instrument(skip(self), err)]
    pub async fn new_image_generation(
        &self,
        install_id: Uuid,
        generation: u64,
        image_id: &str,
    ) -> Result<Option<TeammateInstallRecord>, TeamAgentError> {
        let bumped = sqlx::query_as!(
            InstallRow,
            r#"
            UPDATE team_agent_installs
            SET generation = generation + 1,
                delivery = 0,
                reported_delivery = NULL,
                run_state = 'pending',
                failure = NULL,
                updated_at = now()
            WHERE install_id = $1
              AND generation = $2
              AND checkpoint IS NULL
              AND delivered_image_id IS NOT NULL
              AND delivered_image_id <> $3
            RETURNING install_id, agent_user_id, team_id, harness_id, generation, run_state,
                      failure, delivery, applied_generation, applied_delivery, checkpoint,
                      move_to_harness_id,
                      checkpoint_started_at, delivered_image_id
            "#,
            install_id,
            stored_generation(generation)?,
            image_id,
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?;
        bumped.map(TeammateInstallRecord::try_from).transpose()
    }

    /// Record what `harness` said about an install's delivery; a report
    /// from another machine, about another generation, or about an older
    /// delivery than one it already reported on changes nothing. A
    /// `starting` or `running` report confirms the delivery as applied.
    /// Whether it applied.
    #[tracing::instrument(skip(self), err)]
    pub async fn record_status(
        &self,
        harness: HarnessId,
        install_id: Uuid,
        (generation, delivery): (u64, u64),
        run_state: InstallRunState,
        failure: Option<InstallFailure>,
    ) -> Result<bool, TeamAgentError> {
        let confirms = matches!(
            run_state,
            InstallRunState::Starting | InstallRunState::Running
        );
        let applied = sqlx::query_scalar!(
            r#"
            UPDATE team_agent_installs
            SET run_state = $4,
                failure = $5,
                applied_generation = CASE
                    WHEN $6 AND COALESCE((applied_generation, applied_delivery) < ($2::BIGINT, $3::BIGINT), TRUE)
                    THEN $2 ELSE applied_generation END,
                applied_delivery = CASE
                    WHEN $6 AND COALESCE((applied_generation, applied_delivery) < ($2::BIGINT, $3::BIGINT), TRUE)
                    THEN $3 ELSE applied_delivery END,
                reported_delivery = $3,
                updated_at = now()
            WHERE install_id = $1
              AND (harness_id = $7 OR move_to_harness_id = $7)
              AND generation = $2
              AND delivery >= $3
              AND COALESCE(reported_delivery <= $3, TRUE)
            RETURNING install_id
            "#,
            install_id,
            stored_generation(generation)?,
            stored_generation(delivery)?,
            run_state.as_ref(),
            failure.as_ref().map(AsRef::<str>::as_ref),
            confirms,
            harness.as_uuid(),
        )
        .fetch_optional(&self.pool)
        .await
        .map_err(TeamAgentError::internal)?;
        Ok(applied.is_some())
    }
}
