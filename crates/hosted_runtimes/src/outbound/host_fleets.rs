//! [`Fleets`] for a control plane: a [`FirecrackerFleet`] per host row with
//! a connection, built with this control plane's Firecracker settings, and,
//! for a local stack, the Docker home fleet its environment configures.
//!
//! Rows are read by the operator on each pass; an unchanged row keeps its
//! client, a changed one gets a new client. A row this control plane cannot
//! drive (no Firecracker settings, or no connection) is an error for that
//! host only, never a silent skip.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use crate::domain::ids::HostId;
use crate::domain::image::{GuestImage, GuestImages};
use crate::domain::models::{ControlPlaneId, HostRecord};
use crate::domain::ports::{FleetHandle, Fleets};
use crate::outbound::configured_fleet::ConfiguredFleet;
use crate::outbound::firecracker_fleet::{
    FirecrackerFleet, FirecrackerFleetConfig, FirecrackerFleetError,
};
use firecracker_host_api::client::HostEndpoint;

#[cfg(test)]
mod test;

/// What this control plane needs to drive Firecracker hosts.
#[derive(Clone)]
pub struct FirecrackerSettings {
    /// Owner identity shared by control-plane replicas.
    pub control_plane_id: ControlPlaneId,
    /// Our client certificate chain, PEM, trusted by every host agent.
    pub client_cert_pem: String,
    /// Our client key, PEM.
    pub client_key_pem: zeroize::Zeroizing<String>,
    /// Time to connect to a host agent.
    pub connect_timeout: Duration,
    /// Time for a whole request.
    pub request_timeout: Duration,
    /// Image names new computers are restored from.
    pub images: GuestImages<GuestImage>,
}

impl std::fmt::Debug for FirecrackerSettings {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("FirecrackerSettings")
            .field("control_plane_id", &self.control_plane_id)
            .field("images", &self.images)
            .finish_non_exhaustive()
    }
}

/// Why a host row cannot be driven.
#[derive(Debug, thiserror::Error)]
pub enum HostFleetsError {
    /// This control plane has no Firecracker settings (a local Docker stack).
    #[error(
        "host {host} is a Firecracker host, and this control plane has no Firecracker settings"
    )]
    NoFirecracker {
        /// Host name.
        host: crate::domain::models::HostName,
    },
    /// The row has no endpoint and server certificate.
    #[error("host {host} has no endpoint and server certificate")]
    NoConnection {
        /// Host name.
        host: crate::domain::models::HostName,
    },
    /// The client could not be built.
    #[error(transparent)]
    Firecracker(#[from] FirecrackerFleetError),
}

/// Every host's fleet.
pub struct HostFleets {
    home: Option<ConfiguredFleet>,
    firecracker: Option<FirecrackerSettings>,
    built: Mutex<HashMap<HostId, (HostRecord, Arc<ConfiguredFleet>)>>,
}

impl HostFleets {
    /// Drive Firecracker host rows with `firecracker`, and the local `home`
    /// fleet when there is one.
    pub fn new(home: Option<ConfiguredFleet>, firecracker: Option<FirecrackerSettings>) -> Self {
        Self {
            home,
            firecracker,
            built: Mutex::new(HashMap::new()),
        }
    }

    fn build(&self, host: &HostRecord) -> Result<ConfiguredFleet, HostFleetsError> {
        let settings = self
            .firecracker
            .as_ref()
            .ok_or_else(|| HostFleetsError::NoFirecracker {
                host: host.name.clone(),
            })?;
        let connection = host
            .connection
            .as_ref()
            .ok_or_else(|| HostFleetsError::NoConnection {
                host: host.name.clone(),
            })?;
        Ok(ConfiguredFleet::Firecracker(FirecrackerFleet::new(
            &HostEndpoint {
                url: connection.endpoint.to_string(),
                client_certificate_pem: settings.client_cert_pem.clone(),
                client_key_pem: settings.client_key_pem.clone(),
                server_certificate_pem: connection.server_certificate_pem.clone(),
                connect_timeout: settings.connect_timeout,
                request_timeout: settings.request_timeout,
            },
            FirecrackerFleetConfig {
                control_plane_id: settings.control_plane_id.clone(),
                images: settings.images.clone(),
                host_name: host.name.clone(),
            },
        )?))
    }
}

impl Fleets for HostFleets {
    type Fleet = ConfiguredFleet;
    type Err = HostFleetsError;

    fn home(&self) -> Option<&ConfiguredFleet> {
        self.home.as_ref()
    }

    /// Every row with a connection is a Firecracker host; the home host is
    /// driven through its own environment.
    fn drives(&self, host: &HostRecord) -> bool {
        host.connection.is_some()
    }

    fn fleet(
        &self,
        host: &HostRecord,
    ) -> Result<FleetHandle<'_, ConfiguredFleet>, HostFleetsError> {
        let mut built = self
            .built
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some((record, fleet)) = built.get(&host.id)
            && record == host
        {
            return Ok(FleetHandle::Host(Arc::clone(fleet)));
        }
        let fleet = Arc::new(self.build(host)?);
        built.insert(host.id, (host.clone(), Arc::clone(&fleet)));
        Ok(FleetHandle::Host(fleet))
    }
}
