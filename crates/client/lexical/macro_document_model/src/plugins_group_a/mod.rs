//! Application input and menu policy, registered independently of other migration groups.
mod register;
mod shortcuts;

pub use register::register;

#[cfg(test)]
mod shortcuts_test;
