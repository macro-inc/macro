//! Native MCP servers: users connect remote MCP servers directly, over
//! OAuth (or a linked account), and the AI loop dials them in process.

/// Domain layer: models, ports, and service.
pub mod domain;

/// Inbound adapters (HTTP/axum).
pub mod inbound;

/// Outbound adapters for OAuth, Postgres, and Redis.
pub mod outbound;

/// The native source behind the connectors `Source` port.
#[cfg_attr(
    not(test),
    expect(
        dead_code,
        reason = "composition.rs wires the sources into the services in the next step; remove this then"
    )
)]
mod source;
#[cfg_attr(
    not(test),
    expect(
        unused_imports,
        reason = "composition.rs wires the sources into the services in the next step; remove this then"
    )
)]
pub(crate) use source::NativeSource;
pub(crate) use source::is_github;

#[cfg(test)]
pub(crate) mod memory_store;
