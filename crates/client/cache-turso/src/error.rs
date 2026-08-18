use std::io::ErrorKind;
use thiserror::Error;
use turso_core::{CompletionError, LimboError};

/// The reason an open browser cache must be physically replaced.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Error)]
pub enum PhysicalResetReason {
    /// The database or one of its checked rows is structurally corrupt.
    #[error("corrupt local database")]
    Corruption,
    /// A postcard payload failed the shared cache codec.
    #[error("corrupt cache payload")]
    Codec,
    /// Queue, key, numeric, or relational state violated the frozen schema contract.
    #[error("invalid durable cache state")]
    Invariant,
    /// The browser storage quota is full.
    #[error("browser storage is full")]
    StorageFull,
    /// A commit, rollback, or statement cleanup left transaction durability uncertain.
    #[error("transaction outcome is uncertain")]
    TransactionOutcomeUncertain,
    /// A storage I/O operation failed or returned an unexpected completion state.
    #[error("storage I/O is uncertain")]
    Io,
    /// Required schema or metadata is missing or incompatible.
    #[error("storage compatibility mismatch")]
    Compatibility,
    /// The approved integrity check did not return its sole success row.
    #[error("storage integrity check failed")]
    Integrity,
}

impl PhysicalResetReason {
    pub(crate) const fn latch_code(self) -> u8 {
        match self {
            Self::Corruption => 1,
            Self::Codec => 2,
            Self::Invariant => 3,
            Self::StorageFull => 4,
            Self::TransactionOutcomeUncertain => 5,
            Self::Io => 6,
            Self::Compatibility => 7,
            Self::Integrity => 8,
        }
    }

    pub(crate) const fn from_latch_code(code: u8) -> Option<Self> {
        match code {
            1 => Some(Self::Corruption),
            2 => Some(Self::Codec),
            3 => Some(Self::Invariant),
            4 => Some(Self::StorageFull),
            5 => Some(Self::TransactionOutcomeUncertain),
            6 => Some(Self::Io),
            7 => Some(Self::Compatibility),
            8 => Some(Self::Integrity),
            _ => None,
        }
    }
}

/// Errors produced by the Turso storage backend.
///
/// Errors deliberately contain no entity keys, cache scope, GraphQL text,
/// variables, record bytes, or mutation payloads.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Error)]
pub enum TursoStorageError {
    /// A caller supplied a value outside the checked storage contract.
    #[error("invalid storage input")]
    InvalidInput,
    /// A deterministic database operation failed without an uncertain commit outcome.
    #[error("Turso database operation failed")]
    Database,
    /// The disposable physical database must be closed and replaced.
    #[error("physical cache reset required: {0}")]
    PhysicalResetRequired(PhysicalResetReason),
}

impl TursoStorageError {
    /// Returns whether the current physical database must not be reused.
    pub const fn requires_physical_reset(&self) -> bool {
        matches!(self, Self::PhysicalResetRequired(_))
    }

    /// Returns the physical-reset reason, when replacement is required.
    pub const fn physical_reset_reason(&self) -> Option<PhysicalResetReason> {
        match self {
            Self::PhysicalResetRequired(reason) => Some(*reason),
            Self::InvalidInput | Self::Database => None,
        }
    }

    pub(crate) const fn reset(reason: PhysicalResetReason) -> Self {
        Self::PhysicalResetRequired(reason)
    }

    pub(crate) fn turso(error: LimboError) -> Self {
        match error {
            LimboError::Corrupt(_)
            | LimboError::NotADB
            | LimboError::InvalidColumnType
            | LimboError::InvalidBlobSize(_)
            | LimboError::Page1NotAlloc => Self::reset(PhysicalResetReason::Corruption),
            LimboError::DatabaseFull(_)
            | LimboError::CompletionError(CompletionError::IOError(ErrorKind::StorageFull, _)) => {
                Self::reset(PhysicalResetReason::StorageFull)
            }
            LimboError::CompletionError(
                CompletionError::DecryptionError { .. }
                | CompletionError::PageCodecError { .. }
                | CompletionError::ShortRead { .. }
                | CompletionError::ShortReadWalFrame { .. }
                | CompletionError::WalFramePageMismatch { .. }
                | CompletionError::ChecksumMismatch { .. }
                | CompletionError::ChecksumNotEnabled,
            ) => Self::reset(PhysicalResetReason::Corruption),
            LimboError::CompletionError(_) => Self::reset(PhysicalResetReason::Io),
            _ => Self::Database,
        }
    }

    pub(crate) const fn initialization(self) -> Self {
        match self {
            Self::PhysicalResetRequired(_) => self,
            Self::InvalidInput | Self::Database => Self::reset(PhysicalResetReason::Compatibility),
        }
    }
}
