//! Media paths: how a surface's pixels reach the viewer. One
//! [`ScreenMedia`] per transport; the socket runs one at a time and drops it
//! on stop. Raw RFB from the viewer passes [`VncMedia`]'s gate; typed
//! `input` messages go through the socket's RFB injector instead.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use axum::body::Bytes;
use hosted_runtimes::domain::ids::ComputerId;
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::sync::{Notify, mpsc, watch};

use super::rfb::{GateError, RfbGate};
use super::tunnel::{GuestPort, GuestTunnel, TunnelError};

/// Bytes read from the guest at a time.
const READ_CHUNK: usize = 64 * 1024;

/// What media sends the viewer.
#[derive(Debug)]
pub enum ToViewer {
    /// A binary frame.
    Binary(Bytes),
}

/// What the viewer sends media.
#[derive(Debug)]
pub enum FromViewer {
    /// A binary frame (raw RFB on the VNC transport).
    Binary(Bytes),
}

/// Everything a media path runs with.
pub struct MediaContext {
    /// The computer.
    pub computer_id: ComputerId,
    /// Tunnels into the guest.
    pub tunnel: Arc<dyn GuestTunnel>,
    /// To the viewer, in order.
    pub to_viewer: mpsc::Sender<ToViewer>,
    /// From the viewer.
    pub from_viewer: mpsc::Receiver<FromViewer>,
    /// Whether this viewer drives right now.
    pub driving: watch::Receiver<bool>,
    /// Notified when the driver's input reached the guest through the
    /// media (raw RFB), which keeps the lease alive.
    pub activity: Arc<Notify>,
}

/// How a media path ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaEnd {
    /// The guest side closed: the computer stopped, or its service did.
    GuestClosed,
    /// The viewer side went away.
    ViewerClosed,
}

/// Why a media path failed.
#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    /// The tunnel didn't open.
    #[error(transparent)]
    Tunnel(#[from] TunnelError),
    /// The guest stream failed.
    #[error("guest stream failed")]
    Io(#[from] std::io::Error),
    /// The viewer's RFB broke the gate.
    #[error(transparent)]
    Gate(#[from] GateError),
}

/// A boxed media run.
pub type MediaRun = Pin<Box<dyn Future<Output = Result<MediaEnd, MediaError>> + Send + 'static>>;

/// One transport's media path. Object-safe (`Arc<dyn ScreenMedia>`), hence
/// the boxed future.
pub trait ScreenMedia: Send + Sync + 'static {
    /// Run until the guest or the viewer ends it.
    fn run(&self, context: MediaContext) -> MediaRun;
}

/// Raw RFB from the guest's Xvnc, both ways; the viewer's side passes the
/// [`RfbGate`].
pub struct VncMedia;

impl ScreenMedia for VncMedia {
    fn run(&self, context: MediaContext) -> MediaRun {
        Box::pin(async move {
            let MediaContext {
                computer_id,
                tunnel,
                to_viewer,
                mut from_viewer,
                driving,
                activity,
                ..
            } = context;
            let stream = tunnel.open(computer_id, GuestPort::Rfb).await?;
            let (mut guest_reader, mut guest_writer) = tokio::io::split(stream);
            let mut gate = RfbGate::new();
            let mut buffer = vec![0u8; READ_CHUNK];
            loop {
                tokio::select! {
                    read = guest_reader.read(&mut buffer) => {
                        let read = read?;
                        if read == 0 {
                            return Ok(MediaEnd::GuestClosed);
                        }
                        let frame = Bytes::copy_from_slice(buffer.get(..read).unwrap_or_default());
                        if to_viewer.send(ToViewer::Binary(frame)).await.is_err() {
                            return Ok(MediaEnd::ViewerClosed);
                        }
                    }
                    message = from_viewer.recv() => {
                        let Some(message) = message else {
                            return Ok(MediaEnd::ViewerClosed);
                        };
                        let FromViewer::Binary(bytes) = message;
                        let filtered = gate.filter(&bytes, *driving.borrow())?;
                        if !filtered.forward.is_empty() {
                            guest_writer.write_all(&filtered.forward).await?;
                        }
                        if filtered.input {
                            activity.notify_one();
                        }
                    }
                }
            }
        })
    }
}
