//! Namespace sandbox provider and Connect client.

mod client;
mod errors;
mod manager;
mod types;

pub use client::NamespaceClient;
pub use errors::NamespaceError;
pub use manager::{NamespaceContainer, NamespaceContainerManager};
pub use types::{
    CommandOutput, ContainerSpec, ImageRef, Instance, InstanceId, NamespaceSettings, NamespaceToken,
};
