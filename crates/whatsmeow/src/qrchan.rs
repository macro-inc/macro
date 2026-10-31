// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow qrchan.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go's `QRChannelItem` with an `Event` string is the [`QrChannelItem`] enum.

//! A channel of QR codes that rotates them until pairing ends.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::client::{Client, EventHandler, lock};
use crate::errors::ClientError;
use crate::types::events::{Event, RotateAdvSecret};

/// One item of the QR channel.
#[derive(Clone, Debug)]
pub enum QrChannelItem {
    /// A new QR code to show until `timeout` passes.
    Code {
        /// The QR code contents.
        code: String,
        /// When the next code replaces it.
        timeout: Duration,
    },
    /// Pairing failed.
    Error(Arc<ClientError>),
    /// Pairing succeeded (`QRChannelSuccess`).
    Success,
    /// The codes ran out or the server disconnected before pairing
    /// (`QRChannelTimeout`).
    Timeout,
    /// An unexpected connection event: the device was probably paired before
    /// the channel was set up (`QRChannelErrUnexpectedEvent`).
    ErrUnexpectedEvent,
    /// The client is outdated (`QRChannelClientOutdated`).
    ClientOutdated,
    /// The code was scanned by a phone without multidevice
    /// (`QRChannelScannedWithoutMultidevice`).
    ScannedWithoutMultidevice,
    /// Pairing needs a passkey (`passkey-request`); answer with
    /// `Client::send_passkey_response`.
    PasskeyRequest(Box<crate::types::events::PairPasskeyRequest>),
    /// Show the code and call `Client::send_passkey_confirmation`
    /// (`passkey-confirmation`).
    PasskeyConfirmation(crate::types::events::PairPasskeyConfirmation),
}

impl QrChannelItem {
    /// Go's `Event` string of the item.
    pub fn event(&self) -> &'static str {
        match self {
            QrChannelItem::Code { .. } => "code",
            QrChannelItem::Error(_) => "error",
            QrChannelItem::Success => "success",
            QrChannelItem::Timeout => "timeout",
            QrChannelItem::ErrUnexpectedEvent => "err-unexpected-state",
            QrChannelItem::ClientOutdated => "err-client-outdated",
            QrChannelItem::ScannedWithoutMultidevice => "err-scanned-without-multidevice",
            QrChannelItem::PasskeyRequest(_) => "passkey-request",
            QrChannelItem::PasskeyConfirmation(_) => "passkey-confirmation",
        }
    }
}

const QR_CHANNEL_SIZE: usize = 8;

struct QrChannel {
    client: Weak<Client>,
    handler_id: Mutex<u32>,
    closed: AtomicBool,
    output: Mutex<Option<mpsc::Sender<QrChannelItem>>>,
    stop_qrs: CancellationToken,
    rotate_adv: mpsc::Sender<RotateAdvSecret>,
    rotate_adv_receiver: tokio::sync::Mutex<Option<mpsc::Receiver<RotateAdvSecret>>>,
    cancel: CancellationToken,
}

impl QrChannel {
    /// Marks the channel closed; returns whether it was open.
    fn close(&self) -> bool {
        !self.closed.swap(true, Ordering::SeqCst)
    }

    fn output(&self) -> Option<mpsc::Sender<QrChannelItem>> {
        lock(&self.output).clone()
    }

    fn close_output(&self) {
        lock(&self.output).take();
    }

    async fn send(&self, item: QrChannelItem) {
        if let Some(output) = self.output() {
            let _ = output.send(item).await;
        }
    }

    /// Removes the handler in the background (Go does it in a goroutine to
    /// avoid a deadlock on the handler lock).
    fn remove_handler(&self, client: &Client) {
        client.remove_event_handler(*lock(&self.handler_id));
    }

    async fn emit_qrs(self: Arc<Self>, mut codes: Vec<String>) {
        let Some(client) = self.client.upgrade() else {
            return;
        };
        let mut rotate_adv = self.rotate_adv_receiver.lock().await.take();
        loop {
            if codes.is_empty() {
                if self.close() {
                    tracing::debug!(
                        "ran out of QR codes, closing channel with timeout and disconnecting client"
                    );
                    self.send(QrChannelItem::Timeout).await;
                    self.close_output();
                    self.remove_handler(&client);
                    client.disconnect().await;
                } else {
                    tracing::debug!("ran out of QR codes, but channel is already closed");
                }
                return;
            } else if self.closed.load(Ordering::SeqCst) {
                tracing::debug!("QR code channel is closed, exiting QR emitter");
                return;
            }
            let timeout = if codes.len() == 6 {
                Duration::from_secs(60)
            } else {
                Duration::from_secs(20)
            };
            let next_code = codes.remove(0);
            let accepted = self.output().is_some_and(|output| {
                output
                    .try_send(QrChannelItem::Code {
                        code: next_code.clone(),
                        timeout,
                    })
                    .is_ok()
            });
            if !accepted {
                tracing::debug!("output channel didn't accept code, exiting QR emitter");
                if self.close() {
                    self.close_output();
                    self.remove_handler(&client);
                    client.disconnect().await;
                }
                return;
            }
            let rotation = async {
                match rotate_adv.as_mut() {
                    Some(receiver) => receiver.recv().await,
                    None => std::future::pending().await,
                }
            };
            tokio::select! {
                () = tokio::time::sleep(timeout) => {}
                () = self.stop_qrs.cancelled() => {
                    tracing::debug!("got signal to stop QR emitter");
                    return;
                }
                () = client.expected_disconnect.wait() => {
                    tracing::debug!("client is expected to disconnect, stopping QR emitter");
                    return;
                }
                Some(rotation) = rotation => {
                    tracing::debug!("rotating ADV secrets in remaining QR codes");
                    let mut new_codes = Vec::with_capacity(codes.len() + 1);
                    new_codes.push(next_code.replacen(&rotation.old_secret, &rotation.new_secret, 1));
                    for code in &codes {
                        new_codes.push(code.replacen(&rotation.old_secret, &rotation.new_secret, 1));
                    }
                    codes = new_codes;
                }
                () = self.cancel.cancelled() => {
                    tracing::debug!("context is done, stopping QR emitter");
                    if self.close() {
                        self.close_output();
                        self.remove_handler(&client);
                        client.disconnect().await;
                    }
                }
            }
        }
    }
}

#[async_trait]
impl EventHandler for Arc<QrChannel> {
    async fn handle(&self, event: &Event) -> bool {
        if self.closed.load(Ordering::SeqCst) {
            tracing::debug!("dropping event, QR channel is closed");
            return true;
        }
        let output = match event {
            Event::Qr(qr) => {
                tracing::debug!("received QR code event, starting to emit codes to channel");
                let channel = Arc::clone(self);
                let codes = qr.codes.clone();
                if let Some(client) = self.client.upgrade() {
                    client.spawn(channel.emit_qrs(codes));
                }
                return true;
            }
            Event::RotateAdvSecret(rotation) => {
                if self.rotate_adv.try_send(rotation.clone()).is_err() {
                    tracing::warn!("rotate ADV channel didn't accept event");
                }
                return true;
            }
            Event::QrScannedWithoutMultidevice(_) => {
                tracing::debug!("QR code scanned without multidevice enabled");
                self.send(QrChannelItem::ScannedWithoutMultidevice).await;
                return true;
            }
            Event::PairPasskeyRequest(request) => {
                self.send(QrChannelItem::PasskeyRequest(request.clone()))
                    .await;
                return true;
            }
            Event::PairPasskeyConfirmation(confirmation) => {
                if confirmation.skip_handoff_ux {
                    tracing::debug!("sending automatic passkey confirmation");
                    if let Some(client) = self.client.upgrade()
                        && let Err(error) = client.send_passkey_confirmation().await
                    {
                        self.send(QrChannelItem::Error(Arc::new(ClientError::Other(format!(
                            "failed to send passkey confirmation automatically: {error}"
                        )))))
                        .await;
                    }
                } else {
                    self.send(QrChannelItem::PasskeyConfirmation(confirmation.clone()))
                        .await;
                }
                return true;
            }
            Event::PairPasskeyError(error) => {
                self.send(QrChannelItem::Error(Arc::clone(&error.error)))
                    .await;
                return true;
            }
            Event::ClientOutdated(_) => QrChannelItem::ClientOutdated,
            Event::PairSuccess(_) => QrChannelItem::Success,
            Event::PairError(error) => QrChannelItem::Error(Arc::clone(&error.error)),
            Event::Disconnected(_) => QrChannelItem::Timeout,
            Event::Connected(_)
            | Event::ConnectFailure(_)
            | Event::LoggedOut(_)
            | Event::TemporaryBan(_) => QrChannelItem::ErrUnexpectedEvent,
            _ => return true,
        };
        self.stop_qrs.cancel();
        if self.close() {
            tracing::debug!(status = output.event(), "closing QR channel");
            self.send(output).await;
            self.close_output();
        } else {
            tracing::debug!(
                status = output.event(),
                "got status, but QR channel is already closed"
            );
        }
        if let Some(client) = self.client.upgrade() {
            self.remove_handler(&client);
        }
        true
    }
}

impl Client {
    /// A channel that emits a new QR code whenever the previous one expires.
    ///
    /// Must be called before [`Client::connect`]. The last item is a final
    /// status (success, timeout or an error); the channel closes after it.
    /// Cancelling `cancel` stops the codes and disconnects.
    pub async fn get_qr_channel(
        self: &Arc<Self>,
        cancel: CancellationToken,
    ) -> Result<mpsc::Receiver<QrChannelItem>, ClientError> {
        if self.is_connected().await {
            return Err(ClientError::QrAlreadyConnected);
        } else if self.store.read().await.id.is_some() {
            return Err(ClientError::QrStoreContainsId);
        }
        let (output, receiver) = mpsc::channel(QR_CHANNEL_SIZE);
        let (rotate_adv, rotate_adv_receiver) = mpsc::channel(4);
        let channel = Arc::new(QrChannel {
            client: Arc::downgrade(self),
            handler_id: Mutex::new(0),
            closed: AtomicBool::new(false),
            output: Mutex::new(Some(output)),
            stop_qrs: CancellationToken::new(),
            rotate_adv,
            rotate_adv_receiver: tokio::sync::Mutex::new(Some(rotate_adv_receiver)),
            cancel,
        });
        let handler_id = self.add_event_handler(Arc::new(Arc::clone(&channel)));
        *lock(&channel.handler_id) = handler_id;
        Ok(receiver)
    }
}
