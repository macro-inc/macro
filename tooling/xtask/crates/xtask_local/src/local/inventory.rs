//! The typed inventory of services the orchestrator manages.
//!
//! `RUST_SERVICES` is the single source of truth mapping each Compose service
//! to its cargo binary, owning crate's package, host port, and the modes it
//! participates in. It encodes the two non-obvious bin↔crate mappings
//! (`document_upload_finalizer_local_worker` is built by the
//! `document_upload_finalizer_handler` crate; `pubsub_workers` by the
//! `email_service` crate) and makes "a port on a portless worker"
//! unrepresentable (`host_port: None` == portless worker).

use super::Mode;
use super::instance::Port;

/// A Rust service whose binary the orchestrator builds on the host and mounts
/// into the runtime image at `/app/out/<cargo_bin>`. Several fields document
/// the inventory and back validation/diagnostics rather than the hot path.
#[derive(Clone, Copy, Debug)]
pub struct RustService {
    /// The service key in `docker/docker-compose.yml` (e.g. `authentication-service`).
    pub compose_name: &'static str,
    /// The cargo binary name (e.g. `authentication_service`). Run as
    /// `/app/out/<cargo_bin>`. Bin names are unique workspace-wide, so
    /// `cargo zigbuild --bin <cargo_bin>` resolves the package automatically.
    pub cargo_bin: &'static str,
    /// The owning crate's package name (for documentation / `--package`).
    pub package: &'static str,
    /// The instance host port, or `None` for a portless worker.
    pub host_port: Option<Port>,
    /// The reverse-proxy path prefix the frontend reaches this service through
    /// (e.g. `/auth`), or `None` when it isn't proxied — a portless worker, or
    /// `static_file_service` whose route is the bespoke CDN block in `proxy`.
    /// This is the single source for the generated Caddy routes; it must match
    /// the matching `proxyServers()` entry in `apps/web/.../servers.ts` (guarded by a
    /// test).
    pub path_prefix: Option<&'static str>,
    /// Whether the proxy route must upgrade WebSockets (Caddy `@matcher` shape).
    pub is_websocket: bool,
    /// The run modes this service starts in by default. Empty for opt-in
    /// services, which start only with an explicit profile.
    pub modes: &'static [Mode],
    /// Opt-in services (e.g. `search_processing_service`) only start with an
    /// explicit profile and are never converted to the runtime image.
    pub opt_in: bool,
    /// Built locally with `--no-default-features` (plus any [`Self::build_features`]).
    /// `authentication_service` drops the default `rate_limit` feature (removing
    /// the 1-request/minute login-code throttle that makes local dev painful);
    /// `search_processing_service` drops the default amd64-only `pdf` feature.
    pub no_default_features: bool,
}

impl RustService {
    /// Whether this service starts by default in the given mode.
    pub fn in_mode(&self, mode: Mode) -> bool {
        self.modes.contains(&mode)
    }

    /// Opt-in services (e.g. `search_processing_service`) only start with an
    /// explicit profile and are never converted to the runtime image.
    pub fn is_opt_in(&self) -> bool {
        self.opt_in
    }

    /// Cargo features to re-enable alongside `--no-default-features` for this
    /// service's local build (empty = none). Only `search_processing_service`
    /// needs this: `authentication_service` opts into local passwordless code
    /// responses, and dropping `search_processing_service` default features
    /// removes the amd64-only `pdf` feature, but its bin still requires
    /// `processing`/`service`.
    pub fn build_features(&self) -> &'static [&'static str] {
        match self.cargo_bin {
            "authentication_service" => &["return_passwordless_code"],
            "search_processing_service" => &["processing", "service"],
            _ => &[],
        }
    }
}

/// The full service inventory of the local service binaries.
pub const RUST_SERVICES: &[RustService] = &[
    RustService {
        compose_name: "authentication-service",
        cargo_bin: "authentication_service",
        package: "authentication_service",
        host_port: Some(Port::Auth),
        path_prefix: Some("/auth"),
        is_websocket: false,
        modes: &[Mode::Local, Mode::Dev],
        opt_in: false,
        no_default_features: true,
    },
    RustService {
        compose_name: "connection_gateway",
        cargo_bin: "connection_gateway_service",
        package: "connection_gateway",
        host_port: Some(Port::ConnGateway),
        path_prefix: Some("/connection-gateway"),
        is_websocket: true,
        modes: &[Mode::Local, Mode::Dev],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "contacts_service",
        cargo_bin: "contacts_service",
        package: "contacts_service",
        host_port: Some(Port::Contacts),
        path_prefix: Some("/contacts"),
        is_websocket: false,
        modes: &[Mode::Local, Mode::Dev],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "document_cognition_service",
        cargo_bin: "document_cognition_service",
        package: "document_cognition_service",
        host_port: Some(Port::DocCognition),
        path_prefix: Some("/cognition"),
        is_websocket: false,
        modes: &[Mode::Local, Mode::Dev],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "document_storage_service",
        cargo_bin: "document_storage_service",
        package: "document_storage_service",
        host_port: Some(Port::DocStorage),
        path_prefix: Some("/dss"),
        is_websocket: false,
        modes: &[Mode::Local, Mode::Dev],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "document_upload_finalizer",
        // Built by the document_upload_finalizer_handler crate (src/bin/local_worker.rs),
        // NOT a crate named document_upload_finalizer.
        cargo_bin: "document_upload_finalizer_local_worker",
        package: "document_upload_finalizer_handler",
        host_port: None,
        path_prefix: None,
        is_websocket: false,
        modes: &[Mode::Local],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "email_service",
        cargo_bin: "email_service",
        package: "email_service",
        host_port: Some(Port::Email),
        path_prefix: Some("/email"),
        is_websocket: false,
        modes: &[Mode::Local, Mode::Dev],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "email_pubsub_workers",
        // The pubsub_workers bin is built by the email_service crate
        // (src/bin/pubsub_workers/pubsub_workers.rs).
        cargo_bin: "pubsub_workers",
        package: "email_service",
        host_port: None,
        path_prefix: None,
        is_websocket: false,
        modes: &[Mode::Local],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        // Not a service: the seed CLI binary, shipped into /app/out so the
        // gmail_forwarder sidecar (a bespoke gen_compose block, hence no
        // modes) can run `seed_cli gmail forward` inside the stack.
        compose_name: "gmail_forwarder",
        cargo_bin: "seed_cli",
        package: "seed_cli",
        host_port: None,
        path_prefix: None,
        is_websocket: false,
        modes: &[],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "notification_service",
        cargo_bin: "notification_service",
        package: "notification_service",
        host_port: Some(Port::Notification),
        path_prefix: Some("/notification"),
        is_websocket: false,
        modes: &[Mode::Local, Mode::Dev],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "static_file_service",
        cargo_bin: "static_file_service",
        package: "static_file_service",
        host_port: Some(Port::StaticFile),
        // Routed by the bespoke `/static-file` CDN block in `proxy` (S3 fan-out),
        // not the generic generated route — so no generic prefix here.
        path_prefix: None,
        is_websocket: false,
        modes: &[Mode::Local, Mode::Dev],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "unfurl_service",
        cargo_bin: "unfurl_service",
        package: "unfurl_service",
        host_port: Some(Port::Unfurl),
        path_prefix: Some("/unfurl"),
        is_websocket: false,
        modes: &[Mode::Local, Mode::Dev],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "image_proxy_service",
        cargo_bin: "image_proxy_service",
        package: "image_proxy_service",
        host_port: Some(Port::ImageProxy),
        path_prefix: Some("/image-proxy"),
        is_websocket: false,
        modes: &[Mode::Local, Mode::Dev],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "search_processing_service",
        cargo_bin: "search_processing_service",
        package: "search_processing_service",
        host_port: Some(Port::SearchProcessing),
        path_prefix: None,
        is_websocket: false,
        // Local-only: the default `pdf` feature bundles an amd64-only libpdfium,
        // so local builds drop it (see `build_features`) and cross-compile native
        // like every other service. Dev/prod still deploy from the dedicated
        // Dockerfile with the default (pdf-enabled) build.
        modes: &[Mode::Local],
        opt_in: false,
        no_default_features: true,
    },
    RustService {
        compose_name: "agent_harness_service",
        cargo_bin: "agent_harness_service",
        package: "agent_harness_service",
        host_port: Some(Port::AgentHarness),
        path_prefix: Some("/agent-harness"),
        is_websocket: false,
        // Local stacks default to DEV_DANGEROUS_LOCAL_CONTAINERS, so managed
        // sandboxes run on the host Docker daemon. Daytona is opt-in via
        // DEV_DANGEROUS_LOCAL_CONTAINERS=false DAYTONA_API_KEY=... just run_local.
        modes: &[Mode::Local],
        opt_in: false,
        no_default_features: false,
    },
    RustService {
        compose_name: "mcp_service",
        cargo_bin: "mcp_service",
        package: "mcp_service",
        // No host port and no proxy route: its one local client is the agent
        // egress proxy, which dials it across the compose network as
        // `mcp-service`. (Interactive MCP clients like claude.ai only exist
        // against deployed environments.)
        host_port: None,
        path_prefix: None,
        is_websocket: false,
        modes: &[Mode::Local],
        opt_in: false,
        no_default_features: false,
    },
];

/// The Rust services that participate in `mode` (opt-in services list no modes,
/// so they are naturally excluded).
pub fn services_for_mode(mode: Mode) -> impl Iterator<Item = &'static RustService> {
    RUST_SERVICES.iter().filter(move |s| s.in_mode(mode))
}

/// The cargo binaries to build for a fully local stack (every non-opt-in
/// service's bin, deduplicated). Used by `zigbuild`.
pub fn local_binaries() -> Vec<&'static str> {
    let mut bins: Vec<&'static str> = RUST_SERVICES
        .iter()
        .filter(|s| !s.is_opt_in())
        .map(|s| s.cargo_bin)
        .collect();
    bins.sort_unstable();
    bins.dedup();
    bins
}

#[cfg(test)]
mod test;
