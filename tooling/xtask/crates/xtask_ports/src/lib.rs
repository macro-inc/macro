#![deny(missing_docs)]
//! Port windows and Docker subnets for local stacks, so any number of named
//! instances can run on one machine without anyone picking a `--port-base`.
//!
//! A start locks the machine-wide [`Registry`], reads what the [`Machine`]
//! holds (the caller fills it from Docker), and [`Locked::allocate`] records a
//! free window and subnet block, all before any build:
//!
//! ```no_run
//! use std::collections::BTreeSet;
//! use xtask_ports::{Machine, Registry, Request, Window, probe};
//!
//! # fn main() -> Result<(), xtask_ports::AllocateError> {
//! let mut locked = Registry::machine()?.lock()?;
//! let machine = Machine { routes: xtask_ports::host_routes(), ..Machine::default() };
//! let request = Request { name: "agent-a", own_networks: BTreeSet::new(), window: Window::Any };
//! let allocation = locked.allocate(&request, &machine, &probe::bindable)?;
//! println!("ports {}+, subnet block {}", allocation.port_base, allocation.subnet_block);
//! # Ok(())
//! # }
//! ```
//!
//! This crate never talks to Docker, so every decision is testable from plain
//! data; `xtask_local` reads Docker and names the instances.

mod choose;
mod layout;
mod machine;
mod net;
pub mod probe;
mod registry;

pub use choose::WindowBlocker;
pub use layout::{
    BUCKETS, DEFAULT_INSTANCE, NETWORK_BLOCK_SIZE, Port, STRIDE, SUBNET_PREFIX, WINDOW_START,
    WINDOW_WIDTH, hashed_window, network_subnet,
};
pub use machine::{Census, Container, Machine, Network};
pub use net::{Ipv4Range, host_routes, parse_routes};
pub use registry::{AllocateError, Allocation, Locked, Registry, RegistryError, Request, Window};
