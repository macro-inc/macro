//! Test doubles for the ports the harness delegates through.
//!
//! Shipped rather than `#[cfg(test)]` so binaries can use them too - the same
//! reason `agent_runtime_protocol` ships its `testing` module. agent_proxy's own
//! fakes are private to its test module, so there is nothing to borrow.

pub mod mock_proxy;
