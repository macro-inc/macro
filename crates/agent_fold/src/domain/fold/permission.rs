//! Permission requests and their answers.

use crate::domain::model::{
    MessagePart, PermissionOption, PermissionOptionKind, PermissionOutcome, ToolUseId,
};
use agent_client_protocol::RawJsonRpcParams;
use agent_client_protocol::schema::v1::{
    RequestId, RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
};

use super::convert::deserialize_params;
use super::state::{Changed, FoldState};

impl FoldState {
    /// Handle a `session/request_permission`: add a permission part and record
    /// the request id so its response can be matched.
    pub(super) fn request_permission(
        &mut self,
        request_id: &RequestId,
        params: Option<&RawJsonRpcParams>,
    ) -> Option<Changed> {
        let request = deserialize_params::<RequestPermissionRequest>(params)?;
        let tool_call = ToolUseId(request.tool_call.tool_call_id.0.to_string());
        let options = request
            .options
            .into_iter()
            .map(|option| PermissionOption {
                id: option.option_id.0.to_string(),
                name: option.name,
                kind: permission_option_kind(option.kind),
            })
            .collect();

        // Recorded even with no turn open, so a late response is still
        // recognized as an answer rather than an uncorrelated frame.
        self.pending_permissions
            .insert(request_id.clone(), tool_call.clone());

        let (changed, position) = self.push_agent_part(MessagePart::Permission {
            tool_call: tool_call.clone(),
            options,
            outcome: PermissionOutcome::Pending,
        })?;
        self.open_turn()
            .permission_positions
            .insert(tool_call, position);
        Some(changed)
    }

    /// Handle the response to a permission request.
    pub(super) fn resolve_permission(
        &mut self,
        response_id: &RequestId,
        value: Option<&serde_json::Value>,
    ) -> Option<Changed> {
        let tool_call = self.pending_permissions.remove(response_id)?;

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

        let position = *self.turn.as_ref()?.permission_positions.get(&tool_call)?;
        let (message, parts) = self.agent_parts_mut()?;
        if let Some(MessagePart::Permission {
            outcome: existing, ..
        }) = parts.get_mut(position)
        {
            *existing = outcome;
        }
        Some(Changed::updated(message))
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
