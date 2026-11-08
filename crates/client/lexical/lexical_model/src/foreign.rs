//! Development-only runtime node hosting and suspended updates.
mod pending;
pub use pending::PendingUpdate;

mod hooks;
pub use hooks::{ForeignData, ForeignHooks, ForeignNodeType, Override};

pub(crate) mod dispatch;
pub(crate) mod payload;
pub(crate) mod registry;

pub(crate) mod projection;

pub(crate) mod runtime;
pub use runtime::{ForeignListener, ForeignListenerId, ForeignTransform};

pub(crate) mod state;
pub use state::{ForeignStateCodec, ForeignStateConfig};
