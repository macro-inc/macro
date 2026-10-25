// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow socket/framesocket.go (MPL-2.0, Copyright (c) Tulir Asokan)

use std::pin::Pin;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use futures::stream::{SplitSink, SplitStream};
use futures::{Sink, SinkExt, Stream, StreamExt};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::WebSocketStream;
use tokio_tungstenite::tungstenite::protocol::CloseFrame;
use tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode;
use tokio_tungstenite::tungstenite::{self, Message};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use super::constants::{FRAME_LENGTH_SIZE, FRAME_MAX_SIZE, SocketError, WA_CONN_HEADER};
use super::dialopts::make_dial_request;

/// How many received frames may wait for the consumer. Go's channel is
/// unbuffered; one slot keeps the same backpressure on the read pump.
const FRAME_QUEUE_SIZE: usize = 1;

type BoxedSink = Pin<Box<dyn Sink<Message, Error = tungstenite::Error> + Send>>;
type BoxedStream = Pin<Box<dyn Stream<Item = Result<Message, tungstenite::Error>> + Send>>;

/// What the read pump delivers: Go's `Frames` channel and `OnDisconnect`
/// callback as one stream of events.
#[derive(Debug, PartialEq, Eq)]
pub enum FrameEvent {
    /// One complete frame, without its length prefix.
    Frame(Vec<u8>),
    /// The socket closed. `remote` is true when the connection dropped or was
    /// force closed rather than closed with a status code.
    Disconnected {
        /// Whether the close wasn't a clean local close.
        remote: bool,
    },
}

struct WriteState {
    sink: Option<BoxedSink>,
    /// The connection header, sent once in front of the first frame.
    header: Option<Vec<u8>>,
}

struct Shared {
    write: Mutex<WriteState>,
    connected: AtomicBool,
    closed: AtomicBool,
    cancel: CancellationToken,
    tasks: TaskTracker,
    events: mpsc::Sender<FrameEvent>,
}

/// A websocket that carries WhatsApp's length-prefixed frames.
///
/// Go's `FrameSocket` is created unconnected and then dialed; here
/// [`FrameSocket::connect`] does both and returns the event receiver with the
/// socket. Cloning gives another handle to the same connection.
#[derive(Clone)]
pub struct FrameSocket {
    shared: Arc<Shared>,
}

impl FrameSocket {
    /// Dials the WhatsApp websocket at `url` with the Origin and no-cache
    /// headers whatsmeow sends.
    ///
    /// Go negotiates permessage-deflate; tungstenite doesn't support it, so
    /// the port connects uncompressed.
    pub async fn connect(
        url: &str,
    ) -> Result<(FrameSocket, mpsc::Receiver<FrameEvent>), SocketError> {
        tracing::debug!(url, "dialing websocket");
        let request = make_dial_request(url)?;
        let (stream, _response) = tokio_tungstenite::connect_async_with_config(
            request,
            Some(super::dialopts::websocket_config()),
            false,
        )
        .await
        .map_err(|error| {
            let status_code = match &error {
                tungstenite::Error::Http(response) => Some(response.status().as_u16()),
                _ => None,
            };
            SocketError::DialFailed {
                status_code,
                source: Box::new(error),
            }
        })?;
        Ok(Self::from_websocket(stream))
    }

    /// Runs the frame protocol over an established websocket, such as an
    /// in-memory one in tests.
    pub fn from_websocket<Transport>(
        stream: WebSocketStream<Transport>,
    ) -> (FrameSocket, mpsc::Receiver<FrameEvent>)
    where
        Transport: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (sink, stream): (SplitSink<_, Message>, SplitStream<_>) = stream.split();
        let (events, receiver) = mpsc::channel(FRAME_QUEUE_SIZE);
        let socket = FrameSocket {
            shared: Arc::new(Shared {
                write: Mutex::new(WriteState {
                    sink: Some(Box::pin(sink)),
                    header: Some(WA_CONN_HEADER.to_vec()),
                }),
                connected: AtomicBool::new(true),
                closed: AtomicBool::new(false),
                cancel: CancellationToken::new(),
                tasks: TaskTracker::new(),
                events,
            }),
        };
        let pump = socket.clone();
        socket
            .shared
            .tasks
            .spawn(async move { pump.read_pump(Box::pin(stream)).await });
        socket.shared.tasks.close();
        (socket, receiver)
    }

    /// The connection header that hasn't been sent yet, if any. The noise
    /// handshake mixes it into its hash before the first frame goes out.
    pub async fn header(&self) -> Option<Vec<u8>> {
        self.shared.write.lock().await.header.clone()
    }

    /// Whether the websocket is open.
    pub fn is_connected(&self) -> bool {
        self.shared.connected.load(Ordering::SeqCst)
    }

    /// Closes the websocket. With a close code, a close frame is sent and the
    /// disconnect counts as local; without one, the connection is dropped and
    /// the disconnect counts as remote, like Go's `Close(0)`. Only the first
    /// close emits [`FrameEvent::Disconnected`].
    pub async fn close(&self, code: Option<CloseCode>) {
        if !self.shared.connected.swap(false, Ordering::SeqCst) {
            return;
        }
        self.shared.closed.store(true, Ordering::SeqCst);
        let sink = self.shared.write.lock().await.sink.take();
        if let Some(mut sink) = sink {
            let result = match code {
                Some(code) => {
                    sink.send(Message::Close(Some(CloseFrame {
                        code,
                        reason: "".into(),
                    })))
                    .await
                }
                None => sink.close().await,
            };
            if let Err(error) = result {
                tracing::warn!(error = %error, "error sending close to websocket");
            }
        }
        self.shared.cancel.cancel();
        // Go calls OnDisconnect in a new goroutine, so a consumer that closes
        // the socket while handling a frame doesn't deadlock.
        let events = self.shared.events.clone();
        let remote = code.is_none();
        self.shared.tasks.spawn(async move {
            // The receiver may already be gone, which is fine.
            let _ = events.send(FrameEvent::Disconnected { remote }).await;
        });
    }

    /// Sends one frame, prefixed with its length and, the first time, with
    /// the connection header.
    pub async fn send_frame(&self, data: &[u8]) -> Result<(), SocketError> {
        let mut write = self.shared.write.lock().await;
        let data_length = data.len();
        if data_length >= FRAME_MAX_SIZE {
            return Err(SocketError::FrameTooLarge {
                length: data_length,
            });
        }
        let header = write.header.take().unwrap_or_default();
        let Some(sink) = write.sink.as_mut() else {
            write.header = Some(header).filter(|header| !header.is_empty());
            return Err(SocketError::SocketClosed);
        };

        let mut whole_frame = Vec::with_capacity(header.len() + FRAME_LENGTH_SIZE + data_length);
        whole_frame.extend_from_slice(&header);
        let [_, high, middle, low] = u32::try_from(data_length)
            .map_err(|_| SocketError::FrameTooLarge {
                length: data_length,
            })?
            .to_be_bytes();
        whole_frame.extend_from_slice(&[high, middle, low]);
        whole_frame.extend_from_slice(data);
        sink.send(Message::Binary(whole_frame.into()))
            .await
            .map_err(|error| SocketError::Write(Box::new(error)))
    }

    async fn read_pump(&self, mut stream: BoxedStream) {
        tracing::debug!("frame websocket read pump starting");
        let mut assembler = FrameAssembler::default();
        'pump: loop {
            let message = tokio::select! {
                () = self.shared.cancel.cancelled() => break,
                message = stream.next() => message,
            };
            match message {
                Some(Ok(Message::Binary(data))) => {
                    for frame in assembler.process_data(&data) {
                        if self
                            .shared
                            .events
                            .send(FrameEvent::Frame(frame))
                            .await
                            .is_err()
                        {
                            // Nobody consumes frames anymore.
                            break 'pump;
                        }
                    }
                }
                Some(Ok(Message::Close(_))) | None => break,
                Some(Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_))) => {}
                Some(Ok(Message::Text(_))) => {
                    tracing::warn!("got unexpected websocket text message");
                }
                Some(Err(error)) => {
                    if !self.shared.closed.load(Ordering::SeqCst) {
                        tracing::error!(error = %error, "error reading from websocket");
                    }
                    break;
                }
            }
        }
        tracing::debug!("frame websocket read pump exiting");
        self.close(None).await;
    }
}

/// Reassembles length-prefixed frames from websocket messages, which may
/// split or batch them (Go keeps this state on `FrameSocket`).
#[derive(Default)]
pub struct FrameAssembler {
    incoming_length: usize,
    received_length: usize,
    incoming: Option<Vec<u8>>,
    partial_header: Option<Vec<u8>>,
}

impl FrameAssembler {
    /// Feeds one websocket message in and returns the frames it completed.
    pub fn process_data(&mut self, message: &[u8]) -> Vec<Vec<u8>> {
        let mut frames = Vec::new();
        // A partial header is only ever left at the end of a message, so it
        // is joined with the start of the next one.
        let joined;
        let mut message = match self.partial_header.take() {
            Some(mut partial_header) => {
                partial_header.extend_from_slice(message);
                joined = partial_header;
                joined.as_slice()
            }
            None => message,
        };
        while !message.is_empty() {
            match self.incoming.as_mut() {
                None => {
                    if message.len() >= FRAME_LENGTH_SIZE {
                        let length = (usize::from(message[0]) << 16)
                            + (usize::from(message[1]) << 8)
                            + usize::from(message[2]);
                        self.incoming_length = length;
                        message = &message[FRAME_LENGTH_SIZE..];
                        self.received_length = message.len();
                        if message.len() >= length {
                            frames.push(message[..length].to_vec());
                            message = &message[length..];
                            self.frame_complete();
                        } else {
                            let mut incoming = vec![0; length];
                            incoming[..message.len()].copy_from_slice(message);
                            self.incoming = Some(incoming);
                            message = &[];
                        }
                    } else {
                        tracing::warn!("received partial header (report if this happens often)");
                        self.partial_header = Some(message.to_vec());
                        message = &[];
                    }
                }
                Some(incoming) => {
                    let missing = self.incoming_length - self.received_length;
                    if message.len() >= missing {
                        incoming[self.received_length..].copy_from_slice(&message[..missing]);
                        message = &message[missing..];
                        if let Some(frame) = self.incoming.take() {
                            frames.push(frame);
                        }
                        self.frame_complete();
                    } else {
                        incoming[self.received_length..self.received_length + message.len()]
                            .copy_from_slice(message);
                        self.received_length += message.len();
                        message = &[];
                    }
                }
            }
        }
        frames
    }

    fn frame_complete(&mut self) {
        self.incoming = None;
        self.partial_header = None;
        self.incoming_length = 0;
        self.received_length = 0;
    }
}

#[cfg(test)]
mod test;
