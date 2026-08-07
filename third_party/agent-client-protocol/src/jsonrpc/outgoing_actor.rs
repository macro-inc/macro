// Types re-exported from crate root
use futures::StreamExt as _;
use futures::channel::mpsc;

use crate::jsonrpc::ReplyMessage;
use crate::jsonrpc::protocol_compat::ProtocolCompat;
use crate::jsonrpc::{OutgoingMessage, RawJsonRpcMessage};
use crate::schema::v1::RequestId;

pub type OutgoingMessageTx = mpsc::UnboundedSender<OutgoingMessage>;

pub(crate) fn send_raw_message(
    tx: &OutgoingMessageTx,
    message: OutgoingMessage,
) -> Result<(), crate::Error> {
    tracing::debug!(?message, ?tx, "send_raw_message");
    tx.unbounded_send(message)
        .map_err(crate::util::internal_error)
}

/// Outgoing protocol actor: Converts application-level OutgoingMessage to protocol-level RawJsonRpcMessage.
///
/// This actor handles JSON-RPC protocol semantics:
/// - Subscribes to reply_actor for response correlation
/// - Converts OutgoingMessage variants to RawJsonRpcMessage
///
/// This is the protocol layer - it has no knowledge of how messages are transported.
pub(super) async fn outgoing_protocol_actor(
    mut outgoing_rx: mpsc::UnboundedReceiver<OutgoingMessage>,
    reply_tx: mpsc::UnboundedSender<ReplyMessage>,
    transport_tx: mpsc::UnboundedSender<Result<RawJsonRpcMessage, crate::Error>>,
    protocol_compat: ProtocolCompat,
) -> Result<(), crate::Error> {
    while let Some(message) = outgoing_rx.next().await {
        tracing::debug!(?message, "outgoing_protocol_actor");

        // Create the message to be sent over the transport
        let json_rpc_message = match message {
            OutgoingMessage::Request {
                id,
                role_id,
                method,
                untyped,
                response_tx,
                cancellation_disarm,
            } => {
                let request = match protocol_compat
                    .outgoing_message(untyped)
                    .and_then(|untyped| untyped.into_raw_jsonrpc_message(Some(id.clone())))
                {
                    Ok(request) => request,
                    Err(error) => {
                        tracing::warn!(?id, %method, ?error, "Failed to convert outgoing request");
                        cancellation_disarm.disarm();
                        complete_request_with_error(response_tx, error);
                        continue;
                    }
                };

                // Record where the reply should be sent once it arrives.
                reply_tx
                    .unbounded_send(ReplyMessage::Subscribe {
                        id: id.clone(),
                        role_id,
                        method,
                        sender: response_tx,
                        cancellation_disarm,
                    })
                    .map_err(crate::Error::into_internal_error)?;

                request
            }
            OutgoingMessage::Notification { untyped } => {
                let messages = match protocol_compat.outgoing_notification(untyped) {
                    Ok(messages) => messages,
                    Err(error) => {
                        tracing::warn!(
                            ?error,
                            "Dropping outgoing notification after conversion failed"
                        );
                        continue;
                    }
                };

                for untyped in messages {
                    let message = match untyped.into_raw_jsonrpc_message(None) {
                        Ok(message) => message,
                        Err(error) => {
                            tracing::warn!(
                                ?error,
                                "Dropping outgoing notification after serialization failed"
                            );
                            continue;
                        }
                    };
                    transport_tx
                        .unbounded_send(Ok(message))
                        .map_err(crate::Error::into_internal_error)?;
                }
                continue;
            }
            OutgoingMessage::Response {
                id,
                method,
                response,
            } => match protocol_compat.outgoing_response(&method, response) {
                Ok(value) => {
                    tracing::debug!(?id, "Sending success response");
                    RawJsonRpcMessage::response(id, Ok(value))
                }
                Err(error) => {
                    tracing::warn!(?id, %method, ?error, "Sending error response");
                    RawJsonRpcMessage::response(id, Err(error))
                }
            },
            OutgoingMessage::Error { error } => {
                // JSON-RPC reports parse/invalid-request errors with id null when
                // they cannot be correlated to a specific request.
                RawJsonRpcMessage::response(RequestId::Null, Err(error))
            }
        };

        // Send to transport layer (wrapped in Ok since transport expects Result)
        transport_tx
            .unbounded_send(Ok(json_rpc_message))
            .map_err(crate::Error::into_internal_error)?;
    }
    Ok(())
}

fn complete_request_with_error(
    response_tx: futures::channel::oneshot::Sender<crate::jsonrpc::ResponsePayload>,
    error: crate::Error,
) {
    if response_tx
        .send(crate::jsonrpc::ResponsePayload {
            result: Err(error),
            ack_tx: None,
        })
        .is_err()
    {
        tracing::debug!("Dropped failed outgoing request because receiver was gone");
    }
}

#[cfg(all(test, feature = "unstable_protocol_v2"))]
mod tests {
    use futures::StreamExt as _;
    use futures::channel::{mpsc, oneshot};

    use super::*;
    use crate::Role as _;

    fn malformed_v2_known_method() -> Result<crate::UntypedMessage, crate::Error> {
        crate::UntypedMessage::new("session/new", serde_json::json!({}))
    }

    fn malformed_v2_known_notification() -> Result<crate::UntypedMessage, crate::Error> {
        crate::UntypedMessage::new("session/update", serde_json::json!({}))
    }

    #[tokio::test(flavor = "current_thread")]
    async fn failed_request_conversion_completes_request_locally() -> Result<(), crate::Error> {
        let (outgoing_tx, outgoing_rx) = mpsc::unbounded();
        let (reply_tx, mut reply_rx) = mpsc::unbounded();
        let (transport_tx, mut transport_rx) = mpsc::unbounded();
        let (response_tx, response_rx) = oneshot::channel();

        outgoing_tx
            .unbounded_send(OutgoingMessage::Request {
                id: RequestId::Number(1),
                role_id: crate::Agent.role_id(),
                method: "session/new".into(),
                untyped: malformed_v2_known_method()?,
                response_tx,
                cancellation_disarm: crate::jsonrpc::SentRequestCancellationDisarm::new(),
            })
            .map_err(crate::Error::into_internal_error)?;
        drop(outgoing_tx);

        outgoing_protocol_actor(
            outgoing_rx,
            reply_tx,
            transport_tx,
            ProtocolCompat::new(crate::jsonrpc::protocol_compat::ProtocolMode::v2_agent()),
        )
        .await?;

        let response = response_rx
            .await
            .map_err(crate::Error::into_internal_error)?;
        assert!(
            response.result.is_err(),
            "conversion failure should complete the local request"
        );
        assert!(response.ack_tx.is_none());
        assert!(reply_rx.next().await.is_none());
        assert!(transport_rx.next().await.is_none());

        Ok(())
    }

    #[tokio::test(flavor = "current_thread")]
    async fn failed_notification_conversion_does_not_stop_actor() -> Result<(), crate::Error> {
        let (outgoing_tx, outgoing_rx) = mpsc::unbounded();
        let (reply_tx, _reply_rx) = mpsc::unbounded();
        let (transport_tx, mut transport_rx) = mpsc::unbounded();

        outgoing_tx
            .unbounded_send(OutgoingMessage::Notification {
                untyped: malformed_v2_known_notification()?,
            })
            .map_err(crate::Error::into_internal_error)?;
        outgoing_tx
            .unbounded_send(OutgoingMessage::Notification {
                untyped: crate::UntypedMessage::new(
                    "_local/notify",
                    serde_json::json!({ "ok": true }),
                )?,
            })
            .map_err(crate::Error::into_internal_error)?;
        drop(outgoing_tx);

        outgoing_protocol_actor(
            outgoing_rx,
            reply_tx,
            transport_tx,
            ProtocolCompat::new(crate::jsonrpc::protocol_compat::ProtocolMode::v2_agent()),
        )
        .await?;

        let message = transport_rx
            .next()
            .await
            .expect("valid notification should still be sent")?;
        let RawJsonRpcMessage::Notification(request) = message else {
            panic!("expected outgoing notification request, got {message:?}");
        };
        assert_eq!(&*request.method, "_local/notify");
        assert!(transport_rx.next().await.is_none());

        Ok(())
    }
}
