// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow socket/noisesocket.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use aes_gcm::Aes256Gcm;
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use super::constants::SocketError;
use super::framesocket::{FrameEvent, FrameSocket};
use crate::util::gcmutil;

/// How many decrypted frames may wait for the consumer.
const NOISE_EVENT_QUEUE_SIZE: usize = 1;

/// What an established noise socket delivers: Go's `FrameHandler` and
/// `DisconnectHandler` callbacks as one stream of events.
#[derive(Debug, PartialEq, Eq)]
pub enum NoiseEvent {
    /// One decrypted frame.
    Frame(Vec<u8>),
    /// The underlying socket closed.
    Disconnected {
        /// Whether the close wasn't a clean local close.
        remote: bool,
    },
}

struct WriteState {
    key: Aes256Gcm,
    counter: u32,
}

/// The transport after the noise handshake: every frame is encrypted with
/// AES-256-GCM, with a per-direction counter as the nonce.
pub struct NoiseSocket {
    frame_socket: FrameSocket,
    write: Mutex<WriteState>,
    destroyed: AtomicBool,
    allow_on_disconnect: Arc<AtomicBool>,
    stop_consumer: CancellationToken,
    tasks: TaskTracker,
}

/// The 12-byte nonce for a counter: zeros followed by the big-endian counter.
pub fn generate_iv(count: u32) -> [u8; 12] {
    let mut iv = [0; 12];
    iv[8..].copy_from_slice(&count.to_be_bytes());
    iv
}

pub(super) fn new_noise_socket(
    frame_socket: FrameSocket,
    frames: mpsc::Receiver<FrameEvent>,
    write_key: Aes256Gcm,
    read_key: Aes256Gcm,
) -> (NoiseSocket, mpsc::Receiver<NoiseEvent>) {
    let (events, receiver) = mpsc::channel(NOISE_EVENT_QUEUE_SIZE);
    let socket = NoiseSocket {
        frame_socket,
        write: Mutex::new(WriteState {
            key: write_key,
            counter: 0,
        }),
        destroyed: AtomicBool::new(false),
        allow_on_disconnect: Arc::new(AtomicBool::new(true)),
        stop_consumer: CancellationToken::new(),
        tasks: TaskTracker::new(),
    };
    socket.tasks.spawn(consume_frames(
        frames,
        events,
        read_key,
        socket.stop_consumer.clone(),
        Arc::clone(&socket.allow_on_disconnect),
    ));
    socket.tasks.close();
    (socket, receiver)
}

/// Decrypts frames in order until stopped. A frame that doesn't decrypt is
/// logged and skipped; the read counter still advances, as in Go.
async fn consume_frames(
    mut frames: mpsc::Receiver<FrameEvent>,
    events: mpsc::Sender<NoiseEvent>,
    read_key: Aes256Gcm,
    stop: CancellationToken,
    allow_on_disconnect: Arc<AtomicBool>,
) {
    let mut read_counter: u32 = 0;
    loop {
        let event = tokio::select! {
            () = stop.cancelled() => break,
            event = frames.recv() => event,
        };
        match event {
            Some(FrameEvent::Frame(ciphertext)) => {
                let plaintext =
                    gcmutil::open(&read_key, &generate_iv(read_counter), &ciphertext, &[]);
                read_counter = read_counter.wrapping_add(1);
                match plaintext {
                    Ok(plaintext) => {
                        if events.send(NoiseEvent::Frame(plaintext)).await.is_err() {
                            return;
                        }
                    }
                    Err(error) => tracing::warn!(error = %error, "failed to decrypt frame"),
                }
            }
            Some(FrameEvent::Disconnected { remote }) => {
                // The receiver may already be gone, which is fine.
                let _ = events.send(NoiseEvent::Disconnected { remote }).await;
                return;
            }
            None => return,
        }
    }
    // Stopped: Go still runs the disconnect handler when it is allowed to.
    if !allow_on_disconnect.load(Ordering::SeqCst) {
        return;
    }
    while let Some(event) = frames.recv().await {
        if let FrameEvent::Disconnected { remote } = event {
            let _ = events.send(NoiseEvent::Disconnected { remote }).await;
            return;
        }
    }
}

impl NoiseSocket {
    /// Stops delivering frames. With `disconnect`, the websocket is closed
    /// normally; with `allow_on_disconnect`, the disconnect is still
    /// delivered. Only the first call has an effect.
    pub async fn stop(&self, disconnect: bool, allow_on_disconnect: bool) {
        if self
            .destroyed
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        self.allow_on_disconnect
            .store(allow_on_disconnect, Ordering::SeqCst);
        self.stop_consumer.cancel();
        if disconnect {
            self.frame_socket.close(Some(CloseCode::Normal)).await;
        }
    }

    /// Encrypts and sends one frame.
    ///
    /// The write lock is held until the frame is handed to the websocket, so
    /// frames go out in counter order. Dropping the future mid-send leaves the
    /// counter ahead of the server, which breaks the connection, as a
    /// cancelled context does in Go.
    pub async fn send_frame(&self, plaintext: &[u8]) -> Result<(), SocketError> {
        let mut write = self.write.lock().await;
        let ciphertext = gcmutil::seal(&write.key, &generate_iv(write.counter), plaintext, &[])?;
        write.counter = write.counter.wrapping_add(1);
        self.frame_socket.send_frame(&ciphertext).await
    }

    /// Whether the underlying websocket is open.
    pub fn is_connected(&self) -> bool {
        self.frame_socket.is_connected()
    }
}

#[cfg(test)]
mod test;
