//! MCP tool calls held for the session owner's approval.
//!
//! The egress proxy logs a `pending` notice when it holds a call and one
//! terminal notice when the hold ends. The pending one adds a part to the
//! open turn and an interaction the owner can answer; the terminal one
//! settles both.

use agent_client_protocol::RawJsonRpcParams;
use agent_runtime_protocol::domain::tool_approval::ToolApprovalNotice;

use crate::domain::model::{MessagePart, PendingInteraction, PendingToolApproval};

use super::state::{Changed, FoldState, ToolPath};

impl FoldState {
    /// Handle a `_macro/tool_approval` notice.
    pub(super) fn apply_tool_approval(
        &mut self,
        method: &str,
        params: Option<&RawJsonRpcParams>,
    ) -> Option<(Changed, bool)> {
        let notice = ToolApprovalNotice::from_notification(method, params)?;
        if notice.status.is_pending() {
            self.hold_tool_approval(notice)
        } else {
            self.settle_tool_approval(notice)
        }
    }

    fn hold_tool_approval(&mut self, notice: ToolApprovalNotice) -> Option<(Changed, bool)> {
        // Held calls belong to a running turn; one arriving after its turn
        // closed has nothing left to block.
        self.turn.as_ref()?;
        let (changed, position) = self.push_agent_part(MessagePart::ToolApproval {
            approval_id: notice.approval_id.clone(),
            server_slug: notice.server_slug.clone(),
            server_name: notice.server_name.clone(),
            tool_name: notice.tool_name.clone(),
            arguments: notice.arguments,
            requested_by: notice.requested_by.clone(),
            status: notice.status,
            resolved_by: None,
        })?;
        self.pending_tool_approvals.insert(
            notice.approval_id.clone(),
            ToolPath {
                message: changed.message,
                path: vec![position],
            },
        );
        self.metadata
            .pending_interactions
            .push(PendingInteraction::ToolApproval(PendingToolApproval {
                approval_id: notice.approval_id,
                turn: self.messages[changed.message].id.0,
                server_slug: notice.server_slug,
                server_name: notice.server_name,
                tool_name: notice.tool_name,
                requested_by: notice.requested_by,
            }));
        Some((changed, true))
    }

    fn settle_tool_approval(&mut self, notice: ToolApprovalNotice) -> Option<(Changed, bool)> {
        let at = self.pending_tool_approvals.remove(&notice.approval_id)?;
        if let Some(MessagePart::ToolApproval {
            status,
            resolved_by,
            ..
        }) = self.part_at_mut(&at)
        {
            *status = notice.status;
            resolved_by.clone_from(&notice.resolved_by);
        }
        let before = self.metadata.pending_interactions.len();
        self.metadata.pending_interactions.retain(|pending| {
            !matches!(pending, PendingInteraction::ToolApproval(held) if held.approval_id == notice.approval_id)
        });
        Some((
            Changed::updated(at.message),
            before != self.metadata.pending_interactions.len(),
        ))
    }
}
