//! Source-scoped, read-only team calendar sharing.

mod models;
mod ports;
mod service;

pub use models::*;
pub use ports::*;
pub use service::{CalendarTeamServiceImpl, TeamCalendarError};
