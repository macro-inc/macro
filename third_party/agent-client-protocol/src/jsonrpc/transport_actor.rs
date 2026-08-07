use std::pin::pin;

// Types re-exported from crate root
use crate::jsonrpc::RawJsonRpcMessage;
use crate::schema::v1::Response;
use futures::StreamExt as _;
use futures::channel::mpsc;

/// Transport outgoing actor for line streams: Serializes RawJsonRpcMessage and yields lines.
///
/// This is a line-based variant of `transport_outgoing_actor` that works with a Sink<String>
/// instead of an AsyncWrite byte stream. This enables interception of lines before they are
/// written to the underlying transport.
///
/// This actor handles transport mechanics:
/// - Unwraps Result<Message> from the channel
/// - Serializes RawJsonRpcMessage to JSON strings
/// - Yields newline-terminated strings
/// - Handles serialization errors
///
/// This is the transport layer - it has no knowledge of protocol semantics (IDs, correlation, etc.).
pub(super) async fn transport_outgoing_lines_actor(
    mut transport_rx: mpsc::UnboundedReceiver<Result<RawJsonRpcMessage, crate::Error>>,
    outgoing_lines: impl futures::Sink<String, Error = std::io::Error>,
) -> Result<(), crate::Error> {
    use futures::SinkExt;
    let mut outgoing_lines = pin!(outgoing_lines);

    while let Some(message_result) = transport_rx.next().await {
        // Unwrap the Result - errors here would be from the channel itself
        let json_rpc_message = message_result?;
        match serde_json::to_string(&json_rpc_message) {
            Ok(line) => {
                tracing::trace!(message = %line, "Sending JSON-RPC message");
                outgoing_lines
                    .send(line)
                    .await
                    .map_err(crate::Error::into_internal_error)?;
            }

            Err(serialization_error) => {
                match json_rpc_message {
                    RawJsonRpcMessage::Request(_) | RawJsonRpcMessage::Notification(_) => {
                        // If we failed to serialize a request,
                        // just ignore it.
                        //
                        // Q: (Maybe it'd be nice to "reply" with an error?)
                        tracing::error!(
                            ?serialization_error,
                            "Failed to serialize request, ignoring"
                        );
                    }
                    RawJsonRpcMessage::Response(response) => {
                        // If we failed to serialize a *response*,
                        // send an error in response.
                        let id = match response {
                            Response::Result { id, .. } | Response::Error { id, .. } => id,
                        };
                        tracing::error!(
                            ?serialization_error,
                            ?id,
                            "Failed to serialize response, sending internal_error instead"
                        );
                        let error_line = serde_json::to_string(&RawJsonRpcMessage::response(
                            id,
                            Err(crate::Error::internal_error()),
                        ))
                        .unwrap();
                        outgoing_lines
                            .send(error_line)
                            .await
                            .map_err(crate::Error::into_internal_error)?;
                    }
                }
            }
        }
    }
    Ok(())
}

/// Transport incoming actor for line streams: Parses lines into RawJsonRpcMessage.
///
/// This is a line-based variant of `transport_incoming_actor` that works with a
/// Stream<Item = io::Result<String>> instead of an AsyncRead byte stream. This enables
/// interception of lines before they are parsed.
///
/// This actor handles transport mechanics:
/// - Reads lines from the stream
/// - Parses to RawJsonRpcMessage
/// - Handles parse errors
///
/// This is the transport layer - it has no knowledge of protocol semantics.
pub(super) async fn transport_incoming_lines_actor(
    incoming_lines: impl futures::Stream<Item = std::io::Result<String>>,
    transport_tx: mpsc::UnboundedSender<Result<RawJsonRpcMessage, crate::Error>>,
) -> Result<(), crate::Error> {
    let mut incoming_lines = pin!(incoming_lines);
    while let Some(line_result) = incoming_lines.next().await {
        let line = line_result.map_err(crate::Error::into_internal_error)?;
        tracing::trace!(message = %line, "Received JSON-RPC message");

        let message: Result<RawJsonRpcMessage, _> = serde_json::from_str(&line);
        match message {
            Ok(msg) => {
                transport_tx
                    .unbounded_send(Ok(msg))
                    .map_err(crate::Error::into_internal_error)?;
            }
            Err(_) => {
                transport_tx
                    .unbounded_send(Err(crate::Error::parse_error().data(serde_json::json!(
                        {
                            "line": &line
                        }
                    ))))
                    .map_err(crate::Error::into_internal_error)?;
            }
        }
    }
    Ok(())
}
