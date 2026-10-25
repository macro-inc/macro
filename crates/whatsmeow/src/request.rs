// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
//
// Ported from whatsmeow request.go (MPL-2.0, Copyright (c) Tulir Asokan)
//
// Go's response channels are `oneshot`s: a dropped sender is Go's closed
// channel and is reported as a disconnect.

//! Info queries (`<iq>`) and waiting for their responses.

use std::time::Duration;

use tokio::sync::oneshot;

use crate::binary::{Attrs, Node, NodeContent};
use crate::client::Client;
use crate::errors::{ClientError, DisconnectedError, IqError, parse_iq_error};
use crate::types::Jid;

/// The type of an info query.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, strum::Display, strum::AsRefStr)]
pub enum IqType {
    /// `set`.
    #[strum(serialize = "set")]
    Set,
    /// `get`.
    #[default]
    #[strum(serialize = "get")]
    Get,
}

/// An info query to send (`infoQuery`).
#[derive(Clone, Debug, Default)]
pub(crate) struct InfoQuery {
    pub(crate) namespace: &'static str,
    pub(crate) r#type: IqType,
    pub(crate) to: Jid,
    pub(crate) target: Jid,
    pub(crate) id: String,
    pub(crate) smax_id: String,
    pub(crate) content: Option<NodeContent>,
    /// Zero means [`DEFAULT_REQUEST_TIMEOUT`].
    pub(crate) timeout: Duration,
    pub(crate) no_retry: bool,
}

/// How long [`Client::send_iq`] waits for a response by default.
pub const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(75);

/// Whether the node signals a disconnect rather than a response.
pub(crate) fn is_disconnect_node(node: &Node) -> bool {
    node.tag == "xmlstreamend" || node.tag == "stream:error"
}

/// Whether the disconnect is an auth error that shouldn't be retried.
pub(crate) fn is_auth_error_disconnect(node: &Node) -> bool {
    if node.tag != "stream:error" {
        return false;
    }
    let code = node.attrs.get("code").map(ToString::to_string);
    let conflict_type = node
        .get_optional_child_by_tag(&["conflict"])
        .map(|conflict| conflict.attr_getter().optional_string("type"))
        .unwrap_or_default();
    code.as_deref() == Some("401")
        || conflict_type == "replaced"
        || conflict_type == "device_removed"
}

impl Client {
    /// Sends the node to every response waiter and forgets them.
    pub(crate) fn clear_response_waiters(&self, node: &Node) {
        let waiters = std::mem::take(&mut *self.response_waiters());
        for (_, waiter) in waiters {
            let _ = waiter.send(node.clone());
        }
    }

    pub(crate) fn wait_response(&self, request_id: &str) -> oneshot::Receiver<Node> {
        let (sender, receiver) = oneshot::channel();
        self.response_waiters()
            .insert(request_id.to_owned(), sender);
        receiver
    }

    pub(crate) fn cancel_response(&self, request_id: &str) {
        self.response_waiters().remove(request_id);
    }

    /// Hands an `iq` or `ack` to its waiter; returns whether one was waiting.
    pub(crate) fn receive_response(&self, data: &Node) -> bool {
        let Some(crate::binary::AttributeValue::String(id)) = data.attrs.get("id") else {
            return false;
        };
        if data.tag != "iq" && data.tag != "ack" {
            return false;
        }
        let Some(waiter) = self.response_waiters().remove(id) else {
            return false;
        };
        let _ = waiter.send(data.clone());
        true
    }

    async fn send_iq_async_and_get_data(
        &self,
        query: &mut InfoQuery,
    ) -> Result<(oneshot::Receiver<Node>, Vec<u8>), ClientError> {
        if query.id.is_empty() {
            query.id = self.generate_request_id();
        }
        let waiter = self.wait_response(&query.id);
        let mut attrs = Attrs::from([
            ("id".to_owned(), query.id.clone().into()),
            ("xmlns".to_owned(), query.namespace.into()),
            ("type".to_owned(), query.r#type.as_ref().into()),
        ]);
        if !query.smax_id.is_empty() {
            attrs.insert("smax_id".to_owned(), query.smax_id.clone().into());
        }
        if !query.to.is_empty() {
            attrs.insert("to".to_owned(), query.to.clone().into());
        }
        if !query.target.is_empty() {
            attrs.insert("target".to_owned(), query.target.clone().into());
        }
        let node = Node {
            tag: "iq".to_owned(),
            attrs,
            content: query.content.clone(),
        };
        match self.send_node_and_get_data(&node).await {
            Ok(data) => Ok((waiter, data)),
            Err(error) => {
                self.cancel_response(&query.id);
                Err(error)
            }
        }
    }

    /// Sends an info query without waiting for the response.
    pub(crate) async fn send_iq_async(
        &self,
        mut query: InfoQuery,
    ) -> Result<oneshot::Receiver<Node>, ClientError> {
        self.send_iq_async_and_get_data(&mut query)
            .await
            .map(|(waiter, _)| waiter)
    }

    /// Sends an info query and waits for the response; an error response is
    /// an [`IqError`]. A disconnect before the response retries once after
    /// reconnecting, unless `no_retry` is set.
    #[tracing::instrument(
        name = "whatsmeow.iq",
        skip_all,
        fields(xmlns = query.namespace, iq_type = %query.r#type),
        err
    )]
    pub(crate) async fn send_iq(&self, mut query: InfoQuery) -> Result<Node, ClientError> {
        if query.timeout.is_zero() {
            query.timeout = DEFAULT_REQUEST_TIMEOUT;
        }
        let (waiter, data) = self.send_iq_async_and_get_data(&mut query).await?;
        let response = match tokio::time::timeout(query.timeout, waiter).await {
            Err(_) => {
                self.cancel_response(&query.id);
                return Err(ClientError::IqTimedOut);
            }
            Ok(Err(_)) => crate::client::xml_stream_end_node(),
            Ok(Ok(response)) => response,
        };
        let response = if is_disconnect_node(&response) {
            if query.no_retry {
                return Err(DisconnectedError {
                    action: "info query".to_owned(),
                    node: Some(response),
                }
                .into());
            }
            self.retry_frame("info query", &query.id, &data, response, query.timeout)
                .await?
        } else {
            response
        };
        let response_type = response.attrs.get("type").map(ToString::to_string);
        if response.tag != "iq"
            || (response_type.as_deref() != Some("result")
                && response_type.as_deref() != Some("error"))
        {
            return Err(IqError {
                raw_node: Some(response),
                ..IqError::default()
            }
            .into());
        } else if response_type.as_deref() == Some("error") {
            return Err(parse_iq_error(&response).into());
        }
        Ok(response)
    }

    pub(crate) async fn retry_frame(
        &self,
        request_type: &str,
        id: &str,
        data: &[u8],
        original_response: Node,
        timeout: Duration,
    ) -> Result<Node, ClientError> {
        if is_auth_error_disconnect(&original_response) {
            tracing::debug!(
                request_type,
                "request was interrupted by an auth error disconnect, not retrying"
            );
            return Err(DisconnectedError {
                action: request_type.to_owned(),
                node: Some(original_response),
            }
            .into());
        }
        tracing::debug!(
            request_type,
            "request was interrupted by websocket disconnection, waiting for reconnect to retry"
        );
        if !self.wait_for_connection(Duration::from_secs(5)).await {
            tracing::debug!(
                request_type,
                "websocket didn't reconnect within 5 seconds of failed request"
            );
            return Err(DisconnectedError {
                action: request_type.to_owned(),
                node: Some(original_response),
            }
            .into());
        }
        let socket = self.socket.read().await.socket.clone();
        let Some(socket) = socket else {
            return Err(ClientError::NotConnected);
        };
        let waiter = self.wait_response(id);
        if let Err(error) = socket.send_frame(data).await {
            self.cancel_response(id);
            return Err(error.into());
        }
        let response = if timeout.is_zero() {
            waiter
                .await
                .unwrap_or_else(|_| crate::client::xml_stream_end_node())
        } else {
            match tokio::time::timeout(timeout, waiter).await {
                Err(_) => {
                    self.cancel_response(id);
                    return Err(ClientError::IqTimedOut);
                }
                Ok(response) => response.unwrap_or_else(|_| crate::client::xml_stream_end_node()),
            }
        };
        if is_disconnect_node(&response) {
            tracing::debug!(
                request_type,
                "retried request was interrupted by websocket disconnection, not retrying anymore"
            );
            return Err(DisconnectedError {
                action: format!("{request_type} (retry)"),
                node: Some(response),
            }
            .into());
        }
        Ok(response)
    }
}
