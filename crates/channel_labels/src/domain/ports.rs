//! Ports (trait contracts) for the channel labels domain.

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{
    ChannelLabel, ChannelLabelRule, ChannelLabelsError, ChannelLabelsReceipt, ChannelLabelsScope,
    LabelWriteOutcome, NewChannelLabel, SetChannelLabelOutcome, SmartTagPreview,
};

/// Outbound persistence port for channel labels.
pub trait ChannelLabelsRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: Send + std::fmt::Debug;

    /// Every label of the scope in manual order. `channel_ids` on each label
    /// is restricted to eligible team channels `viewer` participates in. Shared
    /// labels include only their own team's channels. Manual counts include all
    /// eligible assignments; smart counts include only the viewer's active matches.
    /// Smart memberships are evaluated from current attributes, including matches
    /// already present in another smart tag or manual label.
    fn list_labels(
        &self,
        scope: &ChannelLabelsScope,
        viewer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<ChannelLabel>, Self::Err>> + Send;

    /// One label of the scope, viewer-relative like [`Self::list_labels`].
    fn get_label(
        &self,
        scope: &ChannelLabelsScope,
        label_id: Uuid,
        viewer: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<ChannelLabel>, Self::Err>> + Send;

    /// Append a label to the scope's list. `name` is already trimmed and
    /// validated. Creation and all channel assignments must commit atomically.
    /// The viewer must actively participate in every requested channel, and
    /// [`ChannelLabelsScope::can_label_channel`] must allow its owning team;
    /// invalid channels must leave the label and all assignments unchanged.
    /// A validated smart rule is persisted without any manual assignments.
    fn create_label(
        &self,
        scope: &ChannelLabelsScope,
        name: &str,
        channel_ids: &[Uuid],
        viewer: &MacroUserIdStr<'_>,
        rule: Option<&ChannelLabelRule>,
    ) -> impl Future<Output = Result<LabelWriteOutcome, Self::Err>> + Send;

    /// Rename a label of the scope. `name` and any supplied rule are validated.
    /// Omitted rules preserve the existing rule; only smart tags receive updates.
    fn rename_label(
        &self,
        scope: &ChannelLabelsScope,
        label_id: Uuid,
        name: &str,
        viewer: &MacroUserIdStr<'_>,
        rule: Option<&ChannelLabelRule>,
    ) -> impl Future<Output = Result<LabelWriteOutcome, Self::Err>> + Send;

    /// Delete a label of the scope; its channels become unlabelled.
    ///
    /// Returns `true` when a row was removed.
    fn delete_label(
        &self,
        scope: &ChannelLabelsScope,
        label_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Put `channel_id` into `label_id` (or into no label when `None`).
    ///
    /// The actor must actively participate in the channel. Assignments require
    /// [`ChannelLabelsScope::can_label_channel`]; removals may clear historical
    /// ineligible assignments. A label must belong to the authorized scope;
    /// other scopes must remain unchanged.
    /// Smart tags reject manual assignment with `SmartTagReadOnly`.
    fn set_channel_label(
        &self,
        scope: &ChannelLabelsScope,
        channel_id: Uuid,
        label_id: Option<Uuid>,
        actor: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<SetChannelLabelOutcome, Self::Err>> + Send;

    /// Preview a validated rule using only the viewer's active channel memberships
    /// permitted by [`ChannelLabelsScope::can_label_channel`].
    /// Match literal substrings case-insensitively; return at most `limit` names
    /// and the full visible count. The same rule determines smart tag membership.
    fn preview_smart_tag(
        &self,
        scope: &ChannelLabelsScope,
        viewer: &MacroUserIdStr<'_>,
        rule: &ChannelLabelRule,
        limit: u16,
    ) -> impl Future<Output = Result<SmartTagPreview, Self::Err>> + Send;
}

/// Inbound service port: the channel labels API used by drivers.
pub trait ChannelLabelsService: Send + Sync + 'static {
    /// Every label of the caller's authorized scope, in manual order, with the channels
    /// the caller can see.
    fn list_labels(
        &self,
        receipt: &ChannelLabelsReceipt,
    ) -> impl Future<Output = Result<Vec<ChannelLabel>, ChannelLabelsError>> + Send;

    /// Create a label for the caller's authorized scope and move the given channels into it.
    fn create_label(
        &self,
        receipt: &ChannelLabelsReceipt,
        label: NewChannelLabel,
    ) -> impl Future<Output = Result<ChannelLabel, ChannelLabelsError>> + Send;

    /// Rename a label of the caller's authorized scope.
    fn rename_label(
        &self,
        receipt: &ChannelLabelsReceipt,
        label_id: Uuid,
        name: String,
        rule: Option<ChannelLabelRule>,
    ) -> impl Future<Output = Result<ChannelLabel, ChannelLabelsError>> + Send;

    /// Delete a label of the caller's authorized scope; its channels return to the plain list.
    fn delete_label(
        &self,
        receipt: &ChannelLabelsReceipt,
        label_id: Uuid,
    ) -> impl Future<Output = Result<(), ChannelLabelsError>> + Send;

    /// Move a channel into a label of the caller's authorized scope, or out of any label.
    fn set_channel_label(
        &self,
        receipt: &ChannelLabelsReceipt,
        channel_id: Uuid,
        label_id: Option<Uuid>,
    ) -> impl Future<Output = Result<(), ChannelLabelsError>> + Send;

    /// Preview an automatic grouping rule without creating a tag.
    fn preview_smart_tag(
        &self,
        receipt: &ChannelLabelsReceipt,
        rule: ChannelLabelRule,
    ) -> impl Future<Output = Result<SmartTagPreview, ChannelLabelsError>> + Send;
}
