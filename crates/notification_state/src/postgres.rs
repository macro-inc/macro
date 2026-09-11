//! PostgreSQL representation, kept separate from the shared domain state.

use crate::NotificationState;
use sqlx::postgres::{PgArgumentBuffer, PgHasArrayType, PgTypeInfo, PgValueRef};
use sqlx::{Decode, Encode, Postgres, Type};

#[cfg(test)]
mod test;

/// SQLx representation of the `notification_state` PostgreSQL enum.
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::Type)]
#[sqlx(type_name = "notification_state", rename_all = "lowercase")]
pub enum PgNotificationState {
    /// An unacknowledged notification.
    Unseen,
    /// An acknowledged, active notification.
    Seen,
    /// A completed notification.
    Done,
}

// Enable SQLx only for persistence consumers. The domain definition remains
// independent of SQLx, including in wasm builds used by item filters.
impl Type<Postgres> for NotificationState {
    fn type_info() -> PgTypeInfo {
        <PgNotificationState as Type<Postgres>>::type_info()
    }
}

impl PgHasArrayType for NotificationState {
    fn array_type_info() -> PgTypeInfo {
        PgNotificationState::array_type_info()
    }
}

impl<'r> Decode<'r, Postgres> for NotificationState {
    fn decode(value: PgValueRef<'r>) -> Result<Self, sqlx::error::BoxDynError> {
        PgNotificationState::decode(value).map(Into::into)
    }
}

impl<'q> Encode<'q, Postgres> for NotificationState {
    fn encode_by_ref(
        &self,
        buffer: &mut PgArgumentBuffer,
    ) -> Result<sqlx::encode::IsNull, sqlx::error::BoxDynError> {
        <PgNotificationState as Encode<'q, Postgres>>::encode_by_ref(
            &PgNotificationState::from(*self),
            buffer,
        )
    }
}

impl From<NotificationState> for PgNotificationState {
    fn from(state: NotificationState) -> Self {
        match state {
            NotificationState::Unseen => Self::Unseen,
            NotificationState::Seen => Self::Seen,
            NotificationState::Done => Self::Done,
        }
    }
}

impl From<PgNotificationState> for NotificationState {
    fn from(state: PgNotificationState) -> Self {
        match state {
            PgNotificationState::Unseen => Self::Unseen,
            PgNotificationState::Seen => Self::Seen,
            PgNotificationState::Done => Self::Done,
        }
    }
}
