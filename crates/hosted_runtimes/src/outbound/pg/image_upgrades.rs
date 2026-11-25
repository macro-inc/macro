//! [`ImageUpgrades`] in `image_upgrade` and `image_upgrade_computer`.

use super::*;
use crate::domain::image_upgrade::{
    ComputerUpgrade, ComputerUpgradeState, ImageFiles, ImageSource, ImageUpgrade, ImageUpgrades,
    ImageVersion, NewImageUpgrade, StartUpgradeError, UpgradeId, UpgradeState,
};

struct UpgradeRow {
    id: Uuid,
    image: String,
    files: serde_json::Value,
    sources: Option<serde_json::Value>,
    batch_size: i16,
    idle_deadline_at: DateTime<Utc>,
    reconnect_timeout_seconds: i32,
    state: UpgradeState,
    error: Option<String>,
    created_by: String,
    created_at: DateTime<Utc>,
}

impl TryFrom<UpgradeRow> for ImageUpgrade {
    type Error = PgComputerError;

    fn try_from(row: UpgradeRow) -> Result<Self, PgComputerError> {
        Ok(Self {
            id: UpgradeId::new(row.id),
            image: ImageVersion::try_new(&row.image)
                .map_err(|error| PgComputerError::Corrupt(error.to_string()))?,
            files: serde_json::from_value::<ImageFiles>(row.files)?,
            sources: row
                .sources
                .map(serde_json::from_value::<Vec<ImageSource>>)
                .transpose()?,
            batch_size: u8::try_from(row.batch_size)?,
            idle_deadline_at: row.idle_deadline_at,
            reconnect_timeout: chrono::Duration::seconds(i64::from(row.reconnect_timeout_seconds)),
            state: row.state,
            error: row.error,
            created_by: row.created_by,
            created_at: row.created_at,
        })
    }
}

struct ComputerRow {
    upgrade_id: Uuid,
    computer_id: Uuid,
    position: i16,
    state: ComputerUpgradeState,
    old_image: Option<String>,
    new_image: String,
    phase_started_at: Option<DateTime<Utc>>,
    reconnected_at: Option<DateTime<Utc>>,
    error: Option<String>,
}

fn guest_image(image: &str) -> Result<GuestImage, PgComputerError> {
    GuestImage::try_new(image)
        .map_err(|_| PgComputerError::Corrupt("invalid image name".to_owned()))
}

impl TryFrom<ComputerRow> for ComputerUpgrade {
    type Error = PgComputerError;

    fn try_from(row: ComputerRow) -> Result<Self, PgComputerError> {
        Ok(Self {
            upgrade_id: UpgradeId::new(row.upgrade_id),
            computer_id: ComputerId::new_from_uuid(row.computer_id),
            position: u16::try_from(row.position)?,
            state: row.state,
            old_image: row.old_image.as_deref().map(guest_image).transpose()?,
            new_image: guest_image(&row.new_image)?,
            phase_started_at: row.phase_started_at,
            reconnected_at: row.reconnected_at,
            error: row.error,
        })
    }
}

impl PgComputerRepo {
    /// macrod connected: noted on the computer's upgrade row while an
    /// upgrade has it under way, in the transaction applying the event.
    pub(super) async fn note_upgrade_reconnect(
        tx: &mut Tx<'_>,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> Result<(), PgComputerError> {
        sqlx::query!(
            r#"
            UPDATE image_upgrade_computer
            SET reconnected_at = $2, updated_at = $2
            WHERE computer_id = $1 AND state IN ('replacing', 'verifying', 'rolling_back')
            "#,
            computer_id.as_uuid(),
            now,
        )
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn upgrade_computers(
        &self,
        upgrade_id: Uuid,
    ) -> Result<Vec<ComputerUpgrade>, PgComputerError> {
        sqlx::query_as!(
            ComputerRow,
            r#"
            SELECT upgrade_id, computer_id, position,
                   state AS "state: ComputerUpgradeState", old_image, new_image,
                   phase_started_at, reconnected_at, error
            FROM image_upgrade_computer
            WHERE upgrade_id = $1
            ORDER BY position
            "#,
            upgrade_id,
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(ComputerUpgrade::try_from)
        .collect()
    }
}

impl ImageUpgrades for PgComputerRepo {
    type Err = PgComputerError;

    #[tracing::instrument(name = "computer.image_upgrade.create", skip_all, fields(image = %upgrade.image, computers = upgrade.computers.len()), err)]
    async fn create_upgrade(
        &self,
        upgrade: &NewImageUpgrade,
        files: &ImageFiles,
        now: DateTime<Utc>,
    ) -> Result<Result<ImageUpgrade, StartUpgradeError>, PgComputerError> {
        let files_json = serde_json::to_value(files)?;
        let mut tx = self.pool.begin().await?;
        // Starts serialize here, so two of one version can't both pass the
        // history check below. Operators only: the table is tiny.
        sqlx::query!("LOCK TABLE image_upgrade IN SHARE ROW EXCLUSIVE MODE")
            .execute(&mut *tx)
            .await?;
        // A version is immutable: an earlier upgrade of it must have rolled
        // out these very files.
        let earlier = sqlx::query_scalar!(
            "SELECT files FROM image_upgrade WHERE image = $1",
            upgrade.image.as_str(),
        )
        .fetch_all(&mut *tx)
        .await?;
        for earlier in earlier {
            if serde_json::from_value::<ImageFiles>(earlier)? != *files {
                return Ok(Err(StartUpgradeError::VersionReused(upgrade.image.clone())));
            }
        }
        let computer_ids: Vec<Uuid> = upgrade
            .computers
            .iter()
            .map(|computer_id| computer_id.as_uuid())
            .collect();
        let known: Vec<Uuid> = sqlx::query_scalar!(
            "SELECT id FROM hosted_runtime WHERE id = ANY($1)",
            &computer_ids,
        )
        .fetch_all(&mut *tx)
        .await?;
        if let Some(unknown) = upgrade
            .computers
            .iter()
            .find(|computer_id| !known.contains(&computer_id.as_uuid()))
        {
            return Ok(Err(StartUpgradeError::UnknownComputer(*unknown)));
        }
        let row = sqlx::query_as!(
            UpgradeRow,
            r#"
            INSERT INTO image_upgrade
                (id, image, files, sources, batch_size, idle_deadline_at,
                 reconnect_timeout_seconds, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
            ON CONFLICT ((true)) WHERE finished_at IS NULL DO NOTHING
            RETURNING id, image, files, sources, batch_size, idle_deadline_at,
                      reconnect_timeout_seconds, state AS "state: UpgradeState", error,
                      created_by, created_at
            "#,
            UpgradeId::generate().into_inner(),
            upgrade.image.as_str(),
            files_json,
            serde_json::to_value(&upgrade.sources)?,
            i16::from(upgrade.batch_size),
            now + upgrade.idle_wait,
            i32::try_from(upgrade.reconnect_timeout.num_seconds())?,
            upgrade.created_by,
            now,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(row) = row else {
            return Ok(Err(StartUpgradeError::AnotherUnderWay));
        };
        let positions: Vec<i16> = (0..computer_ids.len())
            .map(i16::try_from)
            .collect::<Result<_, _>>()?;
        sqlx::query!(
            r#"
            INSERT INTO image_upgrade_computer (upgrade_id, computer_id, position, new_image)
            SELECT $1, computer_id, position, $4
            FROM unnest($2::uuid[], $3::smallint[]) AS computer (computer_id, position)
            "#,
            row.id,
            &computer_ids,
            &positions,
            upgrade.image.as_str(),
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(Ok(ImageUpgrade::try_from(row)?))
    }

    async fn lease_upgrade(
        &self,
        holder: Uuid,
        now: DateTime<Utc>,
        until: DateTime<Utc>,
    ) -> Result<Option<(ImageUpgrade, Vec<ComputerUpgrade>)>, PgComputerError> {
        let row = sqlx::query_as!(
            UpgradeRow,
            r#"
            UPDATE image_upgrade
            SET leased_by = $1, leased_until = $3
            WHERE finished_at IS NULL
              AND (leased_until IS NULL OR leased_until <= $2 OR leased_by = $1)
            RETURNING id, image, files, sources, batch_size, idle_deadline_at,
                      reconnect_timeout_seconds, state AS "state: UpgradeState", error,
                      created_by, created_at
            "#,
            holder,
            now,
            until,
        )
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let computers = self.upgrade_computers(row.id).await?;
        Ok(Some((ImageUpgrade::try_from(row)?, computers)))
    }

    async fn upgrade(
        &self,
        id: UpgradeId,
    ) -> Result<Option<(ImageUpgrade, Vec<ComputerUpgrade>)>, PgComputerError> {
        let row = sqlx::query_as!(
            UpgradeRow,
            r#"
            SELECT id, image, files, sources, batch_size, idle_deadline_at,
                   reconnect_timeout_seconds, state AS "state: UpgradeState", error,
                   created_by, created_at
            FROM image_upgrade WHERE id = $1
            "#,
            id.into_inner(),
        )
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let computers = self.upgrade_computers(row.id).await?;
        Ok(Some((ImageUpgrade::try_from(row)?, computers)))
    }

    async fn update_upgrade(
        &self,
        holder: Uuid,
        upgrade: &ImageUpgrade,
        finished: bool,
        now: DateTime<Utc>,
    ) -> Result<bool, PgComputerError> {
        let sources = upgrade
            .sources
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?;
        let updated = sqlx::query!(
            r#"
            UPDATE image_upgrade
            SET state = $2, error = $3, sources = $4, updated_at = $5,
                finished_at = CASE WHEN $6::boolean THEN $5::timestamptz END,
                leased_by = CASE WHEN $6::boolean THEN NULL ELSE leased_by END,
                leased_until = CASE WHEN $6::boolean THEN NULL ELSE leased_until END
            WHERE id = $1 AND leased_by = $7
            "#,
            upgrade.id.into_inner(),
            upgrade.state as UpgradeState,
            upgrade.error,
            sources,
            now,
            finished,
            holder,
        )
        .execute(&self.pool)
        .await?;
        Ok(updated.rows_affected() == 1)
    }

    async fn update_computer_upgrade(
        &self,
        holder: Uuid,
        computer: &ComputerUpgrade,
        now: DateTime<Utc>,
    ) -> Result<bool, PgComputerError> {
        let mut tx = self.pool.begin().await?;
        if computer.state.holds_computer() {
            let current = sqlx::query_scalar!(
                "SELECT host_id FROM hosted_runtime WHERE id = $1 FOR UPDATE",
                computer.computer_id.as_uuid(),
            )
            .fetch_optional(&mut *tx)
            .await?;
            if current.is_none()
                || Self::runtime_update_pending(&mut tx, computer.computer_id, true).await?
            {
                return Ok(false);
            }
        }
        let updated = sqlx::query!(
            r#"
            UPDATE image_upgrade_computer row
            SET state = $3, old_image = $4, phase_started_at = $5, error = $6, updated_at = $7
            FROM image_upgrade upgrade
            WHERE row.upgrade_id = $1 AND row.computer_id = $2
              AND upgrade.id = row.upgrade_id AND upgrade.leased_by = $8
            "#,
            computer.upgrade_id.into_inner(),
            computer.computer_id.as_uuid(),
            computer.state as ComputerUpgradeState,
            computer.old_image.as_ref().map(GuestImage::as_str),
            computer.phase_started_at,
            computer.error,
            now,
            holder,
        )
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() == 1 && computer.state == ComputerUpgradeState::Upgraded {
            sqlx::query!(
                r#"UPDATE agent_runtime_update SET cleared_at = $2
                   WHERE computer_id = $1 AND outcome = 'needs_operator' AND cleared_at IS NULL"#,
                computer.computer_id.as_uuid(),
                now,
            )
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(updated.rows_affected() == 1)
    }
}
