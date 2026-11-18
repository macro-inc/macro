//! Host rows: how the control plane reaches each Firecracker host, and how
//! many of its effects run at once.

use super::{PgComputerError, PgComputerRepo, host_name};
use crate::domain::ids::HostId;
use crate::domain::models::{HostConnection, HostRecord};

impl PgComputerRepo {
    /// Every host row, oldest first.
    pub(super) async fn host_rows(&self) -> Result<Vec<HostRecord>, PgComputerError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, name, endpoint, server_certificate_pem, max_concurrent_starts
            FROM hosted_runtime_host
            ORDER BY id
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                let name = host_name(&row.name)?;
                // The table keeps both set or both null.
                let connection = match (row.endpoint, row.server_certificate_pem) {
                    (Some(endpoint), Some(server_certificate_pem)) => Some(HostConnection {
                        endpoint: endpoint.parse().map_err(|error| {
                            PgComputerError::InvalidHostEndpoint {
                                name: name.clone(),
                                error,
                            }
                        })?,
                        server_certificate_pem,
                    }),
                    _ => None,
                };
                Ok(HostRecord {
                    id: HostId::new(row.id),
                    name,
                    connection,
                    max_concurrent_starts: u32::try_from(row.max_concurrent_starts)?,
                })
            })
            .collect()
    }
}
