//! Runtime node hosting and suspended updates.
pub(crate) mod native;
mod pending;
pub use pending::{ForeignEditorIdentity, ForeignUpdateIdentity, PendingUpdate};
mod read;
pub use read::{ForeignReadContext, ForeignReadLease, ForeignReadSnapshot, ForeignRecordIdentity};
pub(crate) use read::{ReadOrigin, ReadOriginRef, ReadProjections, RecordIdentityMarker};

mod clone;
pub use clone::ForeignCloneContext;

mod failure;
pub use failure::ForeignReadOperation;

mod hooks;
pub use hooks::{ForeignData, ForeignHook, ForeignHooks, ForeignNodeType, Override};

pub(crate) mod dispatch;
pub(crate) mod payload;
pub(crate) mod registry;
pub(crate) mod text;

pub(crate) mod projection;

pub(crate) mod runtime;
pub use runtime::{ForeignListener, ForeignListenerId, ForeignTransform};

pub(crate) mod state;
pub use state::{ForeignStateCodec, ForeignStateConfig};

mod records;

pub(crate) mod selections;
pub use selections::{ForeignSelectionCapture, ForeignSelectionIdentity};

pub(crate) mod instances;
pub use instances::{
    ForeignCloneLinks, ForeignCloneMode, ForeignInstance, ForeignInstanceClone,
    ForeignInstanceCloneRequest, ForeignInstanceHooks, ForeignPayloadPatch,
};

mod render;
pub use render::{ForeignRenderRecord, ForeignWeakEditorIdentity};

mod selection_values;

mod reserved;

pub(crate) mod native_overlay;
