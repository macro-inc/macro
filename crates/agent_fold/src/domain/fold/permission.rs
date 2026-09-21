//! Permission requests and their answers.

use crate::domain::model::{
    MessagePart, PendingInteraction, PendingPermission, PermissionOption, PermissionOptionKind,
    PermissionOutcome, ToolUseId,
};
use agent_client_protocol::RawJsonRpcParams;
use agent_client_protocol::schema::v1::{
    RequestId, RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
};

use super::convert::deserialize_params;
use super::state::{Changed, FoldState, ToolPath};

impl FoldState {
    /// Handle a `session/request_permission`: add a permission part and record
    /// the request id so its response can be matched.
    pub(super) fn request_permission(
        &mut self,
        request_id: &RequestId,
        params: Option<&RawJsonRpcParams>,
    ) -> Option<(Changed, bool)> {
        let request = deserialize_params::<RequestPermissionRequest>(params)?;
        let tool_call = ToolUseId(request.tool_call.tool_call_id.0.to_string());
        let options: Vec<PermissionOption> = request
            .options
            .into_iter()
            .map(|option| PermissionOption {
                id: option.option_id.0.to_string(),
                name: option.name,
                kind: permission_option_kind(option.kind),
            })
            .collect();

        let (changed, position) = self.push_agent_part(MessagePart::Permission {
            request_id: request_id.into(),
            tool_call: tool_call.clone(),
            options: options.clone(),
            outcome: PermissionOutcome::Pending,
        })?;
        self.pending_permissions.insert(
            request_id.clone(),
            ToolPath {
                message: changed.message,
                path: vec![position],
            },
        );
        self.metadata
            .pending_interactions
            .push(PendingInteraction::Permission(PendingPermission {
                request_id: request_id.into(),
                turn: self.messages[changed.message].id.0,
                tool_call,
                options,
            }));
        Some((changed, true))
    }

    /// Handle the response to a permission request.
    pub(super) fn resolve_permission(
        &mut self,
        response_id: &RequestId,
        value: Option<&serde_json::Value>,
    ) -> Option<(Changed, bool)> {
        let at = self.pending_permissions.remove(response_id)?;

        let outcome = match value {
            // A JSON-RPC error, not a result: the harness failed to answer
            // rather than resolving the request.
            None => PermissionOutcome::Errored,
            Some(value) => {
                match serde_json::from_value::<RequestPermissionResponse>(value.clone()) {
                    Ok(response) => match response.outcome {
                        RequestPermissionOutcome::Selected(selected) => {
                            PermissionOutcome::Selected {
                                option_id: selected.option_id.0.to_string(),
                            }
                        }
                        RequestPermissionOutcome::Cancelled => PermissionOutcome::Cancelled,
                        // `#[non_exhaustive]`; reaching this means ACP added
                        // an outcome after this was written.
                        _ => PermissionOutcome::Unrecognized,
                    },
                    // The result did not match ACP's response shape.
                    Err(_) => PermissionOutcome::Unrecognized,
                }
            }
        };

        if let Some(MessagePart::Permission {
            outcome: existing, ..
        }) = self.part_at_mut(&at)
        {
            *existing = outcome;
        }
        let before = self.metadata.pending_interactions.len();
        self.metadata.pending_interactions.retain(|pending| {
            !matches!(pending, PendingInteraction::Permission(permission) if permission.request_id == response_id.into())
        });
        Some((
            Changed::updated(at.message),
            before != self.metadata.pending_interactions.len(),
        ))
    }
}

pub(super) fn permission_option_kind(
    kind: agent_client_protocol::schema::v1::PermissionOptionKind,
) -> PermissionOptionKind {
    use agent_client_protocol::schema::v1::PermissionOptionKind as Acp;
    match kind {
        Acp::AllowOnce => PermissionOptionKind::AllowOnce,
        Acp::AllowAlways => PermissionOptionKind::AllowAlways,
        Acp::RejectOnce => PermissionOptionKind::RejectOnce,
        Acp::RejectAlways => PermissionOptionKind::RejectAlways,
        // `#[non_exhaustive]`, and unreachable in practice: this only ever
        // runs on a `kind` that already deserialized successfully, and a
        // wire value ACP added after this was written would have failed
        // that deserialize instead of reaching here - see the type's docs.
        _ => PermissionOptionKind::RejectOnce,
    }
}
