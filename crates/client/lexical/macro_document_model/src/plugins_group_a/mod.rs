//! Application input and menu policy, registered independently of other migration groups.
pub mod menu;
mod register;
mod shortcuts;

pub use register::register;

#[cfg(test)]
mod shortcuts_test;

pub use menu::decode_command;

#[cfg(test)]
mod menu_test;
