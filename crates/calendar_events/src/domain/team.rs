//! Source-scoped, read-only team calendar sharing.

mod models;
mod ports;
mod service;

pub use models::*;
pub use ports::*;
#[cfg(feature = "notes")]
pub(crate) use service::project as project_team_source;
pub use service::{CalendarTeamServiceImpl, TeamCalendarError};
