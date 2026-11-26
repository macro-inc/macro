//! Database adapter for private Gemini 4 replay metadata.

use agent::{Gemini4Replay, MAX_GEMINI_4_SESSION_REPLAY_BYTES};
use agent_client_protocol::schema::v1::RequestId;
use agent_session::domain::model::AgentSessionId;
use futures::TryStreamExt;
use model_owner::Owner;
use sqlx::PgPool;
use std::collections::HashMap;

use crate::domain::gemini_replay::Gemini4ReplayStore;

/// Binds the replay store to the runtime database.
pub struct PgGemini4ReplayStore(pub PgPool);

#[async_trait::async_trait]
impl Gemini4ReplayStore for PgGemini4ReplayStore {
    async fn save(
        &self,
        session: AgentSessionId,
        owner: &Owner,
        request: &RequestId,
        replay: &Gemini4Replay,
    ) -> anyhow::Result<()> {
        let request_id = serde_json::to_string(request)?;
        let replay = serde_json::to_value(replay)?;
        let owner = owner
            .as_user()
            .ok_or_else(|| anyhow::anyhow!("Gemini 4 requires a user-owned session"))?;
        let inserted = sqlx::query!(
            r#"
            INSERT INTO agent_session_gemini_4_replay (agent_session_id, request_id, replay)
            SELECT id, $2, $3 FROM agent_session WHERE id = $1 AND owner_id = $4
            ON CONFLICT (agent_session_id, request_id) DO UPDATE SET replay = EXCLUDED.replay
            WHERE agent_session_gemini_4_replay.replay = EXCLUDED.replay
            "#,
            session.as_uuid(),
            request_id,
            replay,
            owner.as_ref(),
        )
        .execute(&self.0)
        .await
        .map_err(|_| anyhow::anyhow!("failed to persist private Gemini 4 replay state"))?;
        anyhow::ensure!(
            inserted.rows_affected() == 1,
            "conflicting Gemini 4 replay state"
        );
        Ok(())
    }

    async fn load(
        &self,
        session: AgentSessionId,
        owner: &Owner,
        requests: &[RequestId],
    ) -> anyhow::Result<HashMap<RequestId, Gemini4Replay>> {
        let Some(owner) = owner.as_user() else {
            return Ok(HashMap::new());
        };
        if requests.is_empty() {
            return Ok(HashMap::new());
        }
        let request_ids = requests
            .iter()
            .map(serde_json::to_string)
            .collect::<Result<Vec<_>, _>>()?;
        let mut rows = sqlx::query!(
            r#"
            SELECT request_id, replay FROM agent_session_gemini_4_replay
            WHERE agent_session_id = $1 AND request_id = ANY($2)
              AND EXISTS (SELECT 1 FROM agent_session WHERE id = $1 AND owner_id = $3)
            "#,
            session.as_uuid(),
            &request_ids,
            owner.as_ref(),
        )
        .fetch(&self.0);
        let mut replays = HashMap::new();
        let mut metadata_bytes = 0;
        while let Some(row) = rows
            .try_next()
            .await
            .map_err(|_| anyhow::anyhow!("failed to load private Gemini 4 replay state"))?
        {
            metadata_bytes += serde_json::to_vec(&row.replay)?.len();
            anyhow::ensure!(
                metadata_bytes <= MAX_GEMINI_4_SESSION_REPLAY_BYTES,
                "private Gemini 4 replay state is too large"
            );
            let request = serde_json::from_str(&row.request_id)
                .map_err(|_| anyhow::anyhow!("invalid Gemini 4 replay request id"))?;
            let replay = serde_json::from_value(row.replay)
                .map_err(|_| anyhow::anyhow!("invalid Gemini 4 replay state"))?;
            replays.insert(request, replay);
        }
        Ok(replays)
    }
}
