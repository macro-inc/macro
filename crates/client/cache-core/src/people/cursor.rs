use super::*;
use sha2::{Digest, Sha256};
use std::cmp::Ordering;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Position {
    pub rank: u8,
    pub score: f64,
    pub timestamp: i64,
    pub user: String,
}
impl Position {
    pub fn from_hit(hit: &PersonHit) -> Self {
        Self {
            rank: hit.match_rank,
            score: hit.score,
            timestamp: hit.timestamp_ms,
            user: hit.user_id.as_ref().into(),
        }
    }
    pub fn compare(&self, rank: u8, score: f64, timestamp: i64, user: &str) -> Ordering {
        self.rank
            .cmp(&rank)
            .then_with(|| self.score.total_cmp(&score))
            .then_with(|| self.timestamp.cmp(&timestamp))
            .then_with(|| user.cmp(&self.user))
    }
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Cursor {
    fingerprint: String,
    pub now_ms: i64,
    pub after: Position,
}

pub(super) fn fingerprint(request: &PeopleSearch, epoch: Uuid) -> Result<String, PeopleError> {
    // Limit may change between windows. The injected clock is carried in the
    // cursor; all inputs affecting eligibility/order are bound here instead.
    let bytes = serde_json::to_vec(&(
        format!("people-policy-v{}", super::PEOPLE_POLICY_VERSION),
        request.scope.clone(),
        epoch,
        request.mode,
        &request.query,
        &request.excluded,
        &request.sender_domain,
    ))?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
impl Cursor {
    pub fn decode(value: &str, fingerprint: &str) -> Result<Self, PeopleError> {
        if value.len() > 4096 {
            return Err(PeopleError::StaleCursor);
        }
        let cursor: Self = serde_json::from_str(value).map_err(|_| PeopleError::StaleCursor)?;
        if cursor.fingerprint != fingerprint || !cursor.after.score.is_finite() {
            return Err(PeopleError::StaleCursor);
        }
        Ok(cursor)
    }
    pub fn encode(
        fingerprint: String,
        now_ms: i64,
        after: Position,
    ) -> Result<String, PeopleError> {
        Ok(serde_json::to_string(&Self {
            fingerprint,
            now_ms,
            after,
        })?)
    }
}
