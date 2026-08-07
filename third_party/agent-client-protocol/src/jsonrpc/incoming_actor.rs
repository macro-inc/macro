// Types re-exported from crate root
use std::collections::HashMap;

use futures::StreamExt as _;
use futures::channel::mpsc;
use futures::channel::oneshot;
use futures_concurrency::stream::StreamExt as _;
use rustc_hash::FxHashMap;
use uuid::Uuid;

use crate::Dispatch;
use crate::RoleId;
use crate::UntypedMessage;
use crate::jsonrpc::ConnectionTo;
use crate::jsonrpc::HandleDispatchFrom;
use crate::jsonrpc::OutgoingMessage;
use crate::jsonrpc::RawJsonRpcMessage;
use crate::jsonrpc::RawJsonRpcParams;
use crate::jsonrpc::ReplyMessage;
use crate::jsonrpc::Responder;
use crate::jsonrpc::ResponseRouter;
use crate::jsonrpc::dynamic_handler::DynHandleDispatchFrom;
use crate::jsonrpc::dynamic_handler::DynamicHandlerMessage;
use crate::jsonrpc::outgoing_actor::send_raw_message;
use crate::jsonrpc::protocol_compat::ProtocolCompat;

use crate::role::Role;
use crate::schema::v1::{RequestId, Response};

use super::Handled;

struct PendingReply {
    method: String,
    role_id: RoleId,
    sender: oneshot::Sender<crate::jsonrpc::ResponsePayload>,
    cancellation_disarm: super::SentRequestCancellationDisarm,
}

/// Incoming protocol actor: The central dispatch loop for a connection.
///
/// This actor handles JSON-RPC protocol semantics:
/// - Routes responses to pending request awaiters
/// - Routes requests/notifications to registered handlers
/// - Converts RawJsonRpcMessage requests/notifications to UntypedMessage for handlers
/// - Manages reply subscriptions from outgoing requests
///
/// This is the protocol layer - it has no knowledge of how messages arrived.
///
/// The type parameter `MyRole` is the role of this endpoint (e.g., `Agent`).
/// Messages are received from `MyRole::Counterpart` (e.g., `Client`).
pub(super) async fn incoming_protocol_actor<Counterpart: Role>(
    counterpart: Counterpart,
    connection: &ConnectionTo<Counterpart>,
    transport_rx: mpsc::UnboundedReceiver<Result<RawJsonRpcMessage, crate::Error>>,
    dynamic_handler_rx: mpsc::UnboundedReceiver<DynamicHandlerMessage<Counterpart>>,
    reply_rx: mpsc::UnboundedReceiver<ReplyMessage>,
    mut handler: impl HandleDispatchFrom<Counterpart>,
    protocol_compat: ProtocolCompat,
) -> Result<(), crate::Error> {
    let mut my_rx = transport_rx
        .map(IncomingProtocolMsg::Transport)
        .merge(dynamic_handler_rx.map(IncomingProtocolMsg::DynamicHandler))
        .merge(reply_rx.map(IncomingProtocolMsg::Reply));

    let mut dynamic_handlers: FxHashMap<Uuid, Box<dyn DynHandleDispatchFrom<Counterpart>>> =
        FxHashMap::default();
    let mut pending_messages: Vec<Dispatch> = vec![];

    let request_cancellations = super::RequestCancellationRegistry::new();

    // Map from request ID to (method, sender) for response dispatch.
    // The method is stored to allow routing responses through typed handlers.
    let mut pending_replies: HashMap<RequestId, PendingReply> = HashMap::new();

    while let Some(message_result) = my_rx.next().await {
        tracing::trace!(message = ?message_result, actor = "incoming_protocol_actor");
        match message_result {
            IncomingProtocolMsg::Reply(message) => match message {
                ReplyMessage::Subscribe {
                    id,
                    role_id,
                    method,
                    sender,
                    cancellation_disarm,
                } => {
                    tracing::trace!(?id, %method, "incoming_actor: subscribing to response");
                    pending_replies.insert(
                        id,
                        PendingReply {
                            method,
                            role_id,
                            sender,
                            cancellation_disarm,
                        },
                    );
                }
            },

            IncomingProtocolMsg::DynamicHandler(message) => match message {
                DynamicHandlerMessage::AddDynamicHandler(uuid, mut handler) => {
                    // Before adding the new handler, give it a chance to process
                    // any pending messages.
                    let mut new_pending_messages = vec![];
                    for pending_message in pending_messages {
                        tracing::trace!(method = pending_message.method(), handler = ?handler.dyn_describe_chain(), "Retrying message");
                        let id = pending_message.id();
                        let method = pending_message.method().to_string();
                        match handler
                            .dyn_handle_dispatch_from(pending_message, connection.clone())
                            .await
                        {
                            Ok(Handled::Yes) => {
                                tracing::trace!("Message handled");
                            }
                            Ok(Handled::No {
                                message: m,
                                retry: _,
                            }) => {
                                tracing::trace!(method = m.method(), handler = ?handler.dyn_describe_chain(), "Message not handled");
                                new_pending_messages.push(m);
                            }
                            Err(err) => {
                                tracing::warn!(?err, handler = ?handler.dyn_describe_chain(), "Dynamic handler errored on pending message, reporting back");
                                report_handler_error(connection, id, method, err)?;
                            }
                        }
                    }
                    pending_messages = new_pending_messages;

                    // Add handler so it will be used for future incoming messages.
                    dynamic_handlers.insert(uuid, handler);
                }
                DynamicHandlerMessage::RemoveDynamicHandler(uuid) => {
                    dynamic_handlers.remove(&uuid);
                }
            },

            IncomingProtocolMsg::Transport(message) => match message {
                Ok(message) => match message {
                    RawJsonRpcMessage::Request(request) => {
                        tracing::trace!(method = %request.method, id = ?request.id, "Handling request");
                        let request_method = request.method.to_string();
                        let request_id = request.id.clone();
                        match dispatch_from_message(
                            connection,
                            request.method,
                            request.params,
                            Some(request.id),
                            &protocol_compat,
                            &request_cancellations,
                        ) {
                            Ok(dispatches) => {
                                for dispatch in dispatches {
                                    dispatch_dispatch(
                                        counterpart.clone(),
                                        connection,
                                        dispatch,
                                        &mut dynamic_handlers,
                                        &mut handler,
                                        &mut pending_messages,
                                        &request_cancellations,
                                    )
                                    .await?;
                                }
                            }
                            Err(error) => {
                                report_handler_error(
                                    connection,
                                    Some(
                                        serde_json::to_value(request_id)
                                            .expect("RequestId serializes infallibly"),
                                    ),
                                    request_method,
                                    error,
                                )?;
                            }
                        }
                    }
                    RawJsonRpcMessage::Notification(notification) => {
                        tracing::trace!(method = %notification.method, "Handling notification");
                        let request_method = notification.method.to_string();
                        match dispatch_from_message(
                            connection,
                            notification.method,
                            notification.params,
                            None,
                            &protocol_compat,
                            &request_cancellations,
                        ) {
                            Ok(dispatches) => {
                                for dispatch in dispatches {
                                    dispatch_dispatch(
                                        counterpart.clone(),
                                        connection,
                                        dispatch,
                                        &mut dynamic_handlers,
                                        &mut handler,
                                        &mut pending_messages,
                                        &request_cancellations,
                                    )
                                    .await?;
                                }
                            }
                            Err(error) => {
                                report_handler_error(connection, None, request_method, error)?;
                            }
                        }
                    }
                    RawJsonRpcMessage::Response(response) => {
                        let (id, result) = match response {
                            Response::Result { id, result } => (id, Ok(result)),
                            Response::Error { id, error } => (id, Err(error)),
                        };

                        tracing::trace!(?id, "Handling response");
                        if let Some(pending_reply) = pending_replies.remove(&id) {
                            let result =
                                protocol_compat.incoming_response(&pending_reply.method, result);
                            // Route the response through the handler chain
                            let dispatch = dispatch_from_response(id, pending_reply, result);
                            dispatch_dispatch(
                                counterpart.clone(),
                                connection,
                                dispatch,
                                &mut dynamic_handlers,
                                &mut handler,
                                &mut pending_messages,
                                &request_cancellations,
                            )
                            .await?;
                        } else {
                            tracing::warn!(
                                ?id,
                                "incoming_actor: received response for unknown id, no subscriber found"
                            );
                        }
                    }
                },
                Err(error) => {
                    // Parse error from transport - send error notification back to remote
                    tracing::warn!(?error, "Transport parse error, sending error notification");
                    connection.send_error_notification(error)?;
                }
            },
        }
    }
    Ok(())
}

#[derive(Debug)]
enum IncomingProtocolMsg<Counterpart: Role> {
    Transport(Result<RawJsonRpcMessage, crate::Error>),
    DynamicHandler(DynamicHandlerMessage<Counterpart>),
    Reply(ReplyMessage),
}

/// Dispatches a JSON-RPC request to the handler.
/// Report an error back to the server if it does not get handled.
fn dispatch_from_message<Counterpart: Role>(
    connection: &ConnectionTo<Counterpart>,
    method: std::sync::Arc<str>,
    params: Option<RawJsonRpcParams>,
    id: Option<RequestId>,
    protocol_compat: &ProtocolCompat,
    request_cancellations: &super::RequestCancellationRegistry,
) -> Result<Vec<Dispatch>, crate::Error> {
    let message = UntypedMessage::new(&method, crate::jsonrpc::params_from_transport(params))
        .expect("well-formed JSON");

    match id {
        Some(id) => {
            let message = protocol_compat.incoming_message(message)?;
            Ok(vec![Dispatch::Request(
                message,
                Responder::new(
                    connection.message_tx.clone(),
                    method.to_string(),
                    id,
                    request_cancellations,
                ),
            )])
        }
        None => Ok(protocol_compat
            .incoming_notification(message)?
            .into_iter()
            .map(Dispatch::Notification)
            .collect()),
    }
}

/// Dispatches a JSON-RPC response through the handler chain.
///
/// This allows handlers to intercept and process responses before they reach
/// the awaiting code. The default behavior is to forward the response to the
/// local awaiter via the oneshot channel.
fn dispatch_from_response(
    id: RequestId,
    pending_reply: PendingReply,
    result: Result<serde_json::Value, crate::Error>,
) -> Dispatch {
    let PendingReply {
        method,
        role_id,
        sender,
        cancellation_disarm,
    } = pending_reply;

    // Create a Dispatch::Response with a ResponseRouter that routes to the oneshot
    let router = ResponseRouter::new(
        method.clone(),
        id.clone(),
        role_id,
        sender,
        cancellation_disarm,
    );
    Dispatch::Response(result, router)
}

#[tracing::instrument(
    skip(connection, dispatch, dynamic_handlers, handler, pending_messages),
    fields(method = dispatch.method()),
    level = "trace",
)]
async fn dispatch_dispatch<Counterpart: Role>(
    counterpart: Counterpart,
    connection: &ConnectionTo<Counterpart>,
    mut dispatch: Dispatch,
    dynamic_handlers: &mut FxHashMap<Uuid, Box<dyn DynHandleDispatchFrom<Counterpart>>>,
    handler: &mut impl HandleDispatchFrom<Counterpart>,
    pending_messages: &mut Vec<Dispatch>,
    request_cancellations: &super::RequestCancellationRegistry,
) -> Result<(), crate::Error> {
    tracing::trace!(?dispatch, "dispatch_dispatch");

    let mut retry_any = false;

    let id = dispatch.id();
    let method = dispatch.method().to_string();

    match request_cancellations.cancel_if_requested(&dispatch) {
        Ok(true) => {
            tracing::debug!(?method, "Marked request as cancelled");
        }
        Ok(false) => {}
        Err(err) => {
            tracing::warn!(
                ?method,
                ?id,
                ?err,
                "Request cancellation notification errored"
            );
            return report_handler_error(connection, id, method, err);
        }
    }

    // First, apply the handlers given by the user.
    tracing::trace!(handler = ?handler.describe_chain(), "Attempting handler chain");
    match handler
        .handle_dispatch_from(dispatch, connection.clone())
        .await
    {
        Ok(Handled::Yes) => {
            tracing::trace!(?method, ?id, handler = ?handler.describe_chain(), "Handler accepted message");
            return Ok(());
        }

        Ok(Handled::No { message: m, retry }) => {
            tracing::trace!(?method, ?id, handler = ?handler.describe_chain(), "Handler declined message");
            dispatch = m;
            retry_any |= retry;
        }

        Err(err) => {
            tracing::warn!(?method, ?id, ?err, handler = ?handler.describe_chain(), "Handler errored, reporting back to remote");
            return report_handler_error(connection, id, method, err);
        }
    }

    // Next, apply any dynamic handlers.
    for dynamic_handler in dynamic_handlers.values_mut() {
        tracing::trace!(handler = ?dynamic_handler.dyn_describe_chain(), "Attempting dynamic handler");
        match dynamic_handler
            .dyn_handle_dispatch_from(dispatch, connection.clone())
            .await
        {
            Ok(Handled::Yes) => {
                tracing::trace!(?method, ?id, handler = ?dynamic_handler.dyn_describe_chain(), "Dynamic handler accepted message");
                return Ok(());
            }

            Ok(Handled::No { message: m, retry }) => {
                tracing::trace!(?method, ?id, handler = ?dynamic_handler.dyn_describe_chain(),  "Dynamic handler declined message");
                retry_any |= retry;
                dispatch = m;
            }

            Err(err) => {
                tracing::warn!(?method, ?id, ?err, handler = ?dynamic_handler.dyn_describe_chain(), "Dynamic handler errored, reporting back to remote");
                return report_handler_error(connection, id, method, err);
            }
        }
    }

    // Finally, apply the default handler for the role.
    tracing::trace!(role = ?counterpart, "Attempting default handler");
    match counterpart
        .default_handle_dispatch_from(dispatch, connection.clone())
        .await
    {
        Ok(Handled::Yes) => {
            tracing::trace!(?method, handler = "default", "Role accepted message");
            return Ok(());
        }
        Ok(Handled::No { message: m, retry }) => {
            tracing::trace!(?method, handler = "default", "Role declined message");
            dispatch = m;
            retry_any |= retry;
        }
        Err(err) => {
            tracing::warn!(
                ?method,
                ?id,
                ?err,
                handler = "default",
                "Default handler errored, reporting back to remote"
            );
            return report_handler_error(connection, id, method, err);
        }
    }

    // If the message was never handled, check whether the retry flag was set.
    // If so, enqueue it for later processing. Else, reject it.
    //
    // An explicit retry request takes precedence over the unhandled-message
    // fallback below, so that handlers may defer notifications to a dynamic
    // handler that has not been registered yet.
    if retry_any {
        tracing::debug!(
            ?method,
            "Retrying message as new dynamic handlers are added"
        );
        pending_messages.push(dispatch);
        Ok(())
    } else {
        match dispatch {
            Dispatch::Notification(_) => {
                tracing::debug!(?method, "Ignoring unhandled notification");
                Ok(())
            }
            Dispatch::Request(..) => {
                tracing::info!(?method, "Rejecting request with error, no handler");
                let method = dispatch.method().to_string();
                dispatch.respond_with_error(
                    crate::Error::method_not_found().data(method),
                    connection.clone(),
                )
            }
            Dispatch::Response(result, router) => {
                tracing::trace!(?method, "Forwarding response");
                router.respond_with_result(result)
            }
        }
    }
}

/// When a handler returns an error, report it back to the remote side instead
/// of propagating it and tearing down the connection.
///
/// For requests (which have an id), sends a JSON-RPC error response.
/// For notifications (no id), sends an out-of-band error notification.
/// For responses, forwards the error to the local awaiter.
fn report_handler_error<Counterpart: Role>(
    connection: &ConnectionTo<Counterpart>,
    id: Option<serde_json::Value>,
    method: String,
    error: crate::Error,
) -> Result<(), crate::Error> {
    match id {
        Some(id) => {
            // Request: send error response with the original request id
            let jsonrpc_id = serde_json::from_value(id).unwrap_or(RequestId::Null);
            send_raw_message(
                &connection.message_tx,
                OutgoingMessage::Response {
                    id: jsonrpc_id,
                    method,
                    response: Err(error),
                },
            )
        }
        None => {
            // Notification or response without id: send error notification
            connection.send_error_notification(error)
        }
    }
}
