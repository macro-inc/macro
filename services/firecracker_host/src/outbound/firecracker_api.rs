//! Firecracker's API over its Unix socket: the few v1.18 requests the agent
//! sends, typed from Firecracker's `firecracker.yaml` (swagger) definitions.

use std::path::{Path, PathBuf};
use std::time::Duration;

use http::{Method, Request, StatusCode};
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper_util::rt::TokioIo;
use serde::Serialize;
use tokio::net::UnixStream;

#[cfg(test)]
mod test;

/// A request Firecracker refused, or a socket that failed.
#[derive(Debug, thiserror::Error)]
pub enum FirecrackerApiError {
    /// The socket failed.
    #[error("firecracker API socket {socket}: {source}")]
    Io {
        /// The socket.
        socket: PathBuf,
        /// Why.
        source: std::io::Error,
    },
    /// HTTP failed.
    #[error("firecracker API: {0}")]
    Http(#[from] hyper::Error),
    /// The request could not be built.
    #[error("firecracker API request: {0}")]
    Request(#[from] http::Error),
    /// The body could not be encoded.
    #[error("firecracker API body: {0}")]
    Encode(#[from] serde_json::Error),
    /// Firecracker answered an error.
    #[error("firecracker {method} {path} answered {status}: {body}")]
    Refused {
        /// Method.
        method: Method,
        /// Path.
        path: String,
        /// Status.
        status: StatusCode,
        /// Its `fault_message`.
        body: String,
    },
    /// The socket did not appear in time.
    #[error("firecracker API socket {0} did not come up")]
    NotReady(PathBuf),
}

/// One VM's API socket.
#[derive(Debug, Clone)]
pub struct FirecrackerApi {
    socket: PathBuf,
}

impl FirecrackerApi {
    /// The API at `socket` (host path of the chroot's `/api.sock`).
    pub fn new(socket: PathBuf) -> Self {
        Self { socket }
    }

    /// Wait until the socket accepts connections. Firecracker gives no
    /// signal when it is up, so this retries the connect.
    #[tracing::instrument(name = "firecracker.api_wait", skip(self), err)]
    pub async fn wait_ready(&self, timeout: Duration) -> Result<(), FirecrackerApiError> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if UnixStream::connect(&self.socket).await.is_ok() {
                return Ok(());
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(FirecrackerApiError::NotReady(self.socket.clone()));
            }
            tokio::time::sleep(Duration::from_millis(1)).await;
        }
    }

    /// `PUT path` with `body`.
    pub async fn put(&self, path: &str, body: &impl Serialize) -> Result<(), FirecrackerApiError> {
        self.send(Method::PUT, path, body).await
    }

    /// `PATCH path` with `body`.
    pub async fn patch(
        &self,
        path: &str,
        body: &impl Serialize,
    ) -> Result<(), FirecrackerApiError> {
        self.send(Method::PATCH, path, body).await
    }

    #[tracing::instrument(name = "firecracker.api", skip(self, body), fields(http.method = %method, url.path = path), err)]
    async fn send(
        &self,
        method: Method,
        path: &str,
        body: &impl Serialize,
    ) -> Result<(), FirecrackerApiError> {
        let stream = UnixStream::connect(&self.socket)
            .await
            .map_err(|source| io_error(&self.socket, source))?;
        let (mut sender, connection) =
            hyper::client::conn::http1::handshake(TokioIo::new(stream)).await?;
        // hyper's connection driver for this one request: it ends with the
        // request, so it needs no tracking.
        tokio::spawn(connection);

        let request = Request::builder()
            .method(method.clone())
            .uri(path)
            .header(http::header::HOST, "localhost")
            .header(http::header::CONTENT_TYPE, "application/json")
            .header(http::header::ACCEPT, "application/json")
            .body(Full::new(Bytes::from(serde_json::to_vec(body)?)))?;
        let response = sender.send_request(request).await?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let body = response.into_body().collect().await?.to_bytes();
        Err(FirecrackerApiError::Refused {
            method,
            path: path.to_owned(),
            status,
            body: String::from_utf8_lossy(&body).into_owned(),
        })
    }
}

fn io_error(socket: &Path, source: std::io::Error) -> FirecrackerApiError {
    FirecrackerApiError::Io {
        socket: socket.to_owned(),
        source,
    }
}

/// `PUT /machine-config`.
#[derive(Debug, Serialize)]
pub struct MachineConfig {
    vcpu_count: u8,
    mem_size_mib: u32,
    smt: bool,
    track_dirty_pages: bool,
}

impl MachineConfig {
    /// `vcpus` and `memory_mib`, no SMT, and always dirty page tracking:
    /// without it a hibernation writes every resident page, not the diff.
    pub fn new(vcpus: u8, memory_mib: u32) -> Self {
        Self {
            vcpu_count: vcpus,
            mem_size_mib: memory_mib,
            smt: false,
            track_dirty_pages: true,
        }
    }
}

/// `PUT /boot-source`.
#[derive(Debug, Serialize)]
pub struct BootSource {
    /// Chroot path of the kernel.
    pub kernel_image_path: String,
    /// Kernel command line.
    pub boot_args: String,
}

/// `PUT /drives/{drive_id}`.
#[derive(Debug, Serialize)]
pub struct Drive {
    /// `rootfs` or `home`.
    pub drive_id: &'static str,
    /// Chroot path.
    pub path_on_host: &'static str,
    /// Firecracker adds `root=/dev/vda` for it.
    pub is_root_device: bool,
    /// Always writable here.
    pub is_read_only: bool,
    /// `Writeback`: honour guest flushes (the default, `Unsafe`, drops them).
    /// Recorded in the snapshot, so the golden decides it for every restore.
    pub cache_type: &'static str,
    /// Pass guest TRIM through, so deleted guest data frees host blocks.
    /// Recorded in the snapshot too.
    pub discard: bool,
}

/// `PATCH /drives/{drive_id}`: reopen the file and re-read its size.
#[derive(Debug, Serialize)]
pub struct DriveUpdate {
    /// `rootfs` or `home`.
    pub drive_id: &'static str,
    /// Chroot path.
    pub path_on_host: &'static str,
}

/// `PUT /network-interfaces/{iface_id}`.
#[derive(Debug, Serialize)]
pub struct NetworkInterface {
    /// `eth0`.
    pub iface_id: &'static str,
    /// The tap in the VM's netns.
    pub host_dev_name: &'static str,
    /// Fixed by the golden for every VM.
    pub guest_mac: &'static str,
}

/// `PUT /mmds/config`.
#[derive(Debug, Serialize)]
pub struct MmdsConfig {
    /// `V2`: session tokens.
    pub version: &'static str,
    /// Interfaces MMDS answers on.
    pub network_interfaces: [&'static str; 1],
}

/// `PUT /vsock`.
#[derive(Debug, Serialize)]
pub struct Vsock {
    /// The guest's CID.
    pub guest_cid: u32,
    /// Chroot path of the hybrid vsock socket.
    pub uds_path: &'static str,
}

/// `PUT /balloon`.
#[derive(Debug, Serialize)]
pub struct Balloon {
    /// Target size of the balloon.
    pub amount_mib: u32,
    /// Give memory back to a guest under pressure.
    pub deflate_on_oom: bool,
    /// Statistics period; 0 keeps idle guests from waking every second.
    pub stats_polling_interval_s: u32,
    /// Report freed guest pages so the host can reclaim them.
    pub free_page_reporting: bool,
}

/// `PUT /actions`.
#[derive(Debug, Serialize)]
pub struct InstanceAction {
    /// `InstanceStart` or `SendCtrlAltDel`.
    pub action_type: &'static str,
}

/// `PATCH /vm`.
#[derive(Debug, Serialize)]
pub struct VmState {
    /// `Paused` or `Resumed`.
    pub state: &'static str,
}

/// `PUT /snapshot/create`.
#[derive(Debug, Serialize)]
pub struct SnapshotCreate {
    /// `Full`, or `Diff`: only pages written since the last load or
    /// snapshot, written into the existing memory file.
    pub snapshot_type: &'static str,
    /// Chroot path of the device state.
    pub snapshot_path: &'static str,
    /// Chroot path of the memory.
    pub mem_file_path: &'static str,
}

/// `PUT /snapshot/load`.
#[derive(Debug, Serialize)]
pub struct SnapshotLoad {
    snapshot_path: &'static str,
    mem_backend: MemoryBackend,
    resume_vm: bool,
    clock_realtime: bool,
    track_dirty_pages: bool,
}

impl SnapshotLoad {
    /// Load `snapshot_path` with `memory_path` mapped privately (File
    /// backend), left paused (drives and MMDS change before the guest
    /// runs), kvmclock advanced by the wall time since the snapshot, and
    /// always dirty page tracking: without it a hibernation writes every
    /// resident page, not the diff.
    pub fn paused(snapshot_path: &'static str, memory_path: &'static str) -> Self {
        Self {
            snapshot_path,
            mem_backend: MemoryBackend {
                backend_type: "File",
                backend_path: memory_path,
            },
            resume_vm: false,
            clock_realtime: true,
            track_dirty_pages: true,
        }
    }
}

/// The `mem_backend` of [`SnapshotLoad`].
#[derive(Debug, Serialize)]
struct MemoryBackend {
    /// `File`: a private mapping of the memory file, shared page cache.
    backend_type: &'static str,
    /// Chroot path of the memory file.
    backend_path: &'static str,
}
