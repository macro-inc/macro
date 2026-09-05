use std::time::Duration;

/// Namespace instance identifier.
#[derive(Debug, Clone)]
pub struct InstanceId(String);

impl InstanceId {
    pub(crate) fn new(value: String) -> Self {
        Self(value)
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for InstanceId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// OCI image reference used to create Namespace instances.
#[derive(Debug, Clone)]
pub struct ImageRef(String);

impl ImageRef {
    /// Wrap an OCI image reference.
    #[must_use]
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub(crate) fn as_str(&self) -> &str {
        &self.0
    }
}

/// A created Namespace instance and its service endpoints.
#[derive(Debug)]
pub struct Instance {
    /// Namespace's identifier for the instance.
    pub id: InstanceId,
    /// Console URL for a human inspecting the instance.
    pub url: String,
    /// Base URL of the command service for this instance.
    pub command_endpoint: String,
}

/// Output produced by a command executed in an instance.
#[derive(Debug)]
pub struct CommandOutput {
    /// Standard output.
    pub stdout: String,
    /// Standard error.
    pub stderr: String,
    /// Process exit status.
    pub exit_code: i32,
}

/// Container-specific values supplied to Namespace instance creation.
#[derive(Debug)]
pub struct ContainerSpec {
    /// OCI image the instance runs.
    pub image_ref: ImageRef,
    /// Environment variables injected into the container.
    pub env: Vec<(String, String)>,
    /// Ports Namespace may expose through ingresses.
    pub exported_ports: Vec<u16>,
}

/// Bearer token used to authenticate with Namespace.
#[derive(Clone)]
pub struct NamespaceToken(String);

impl NamespaceToken {
    /// Wrap a Namespace bearer token.
    #[must_use]
    pub fn new(value: String) -> Self {
        Self(value)
    }

    pub(crate) fn expose(&self) -> &str {
        &self.0
    }
}

/// Settings required to create Namespace-backed containers.
pub struct NamespaceSettings {
    /// Base URL of the regional Namespace Compute API.
    pub api_url: String,
    /// Bearer token used to authenticate with Namespace.
    pub token: NamespaceToken,
    /// OCI image used to create instances.
    pub image_ref: ImageRef,
    /// Maximum lifetime of an instance.
    pub lifetime: Duration,
}
