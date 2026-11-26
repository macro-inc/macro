//! The probe itself, independent of the API it writes through: what a round
//! writes, how it polls search, and what each entity type's cycle changes.

pub mod model;
pub mod ports;
pub mod probe;
pub mod rotation;
pub mod watch;
