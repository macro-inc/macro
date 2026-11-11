//! Validate already-run constructor fields before installing any graph record.
use super::*;
use lexical_rich_nodes::heading::{HeadingNode, HeadingTagType};

enum Payload {
    Text,
    Paragraph,
    LineBreak,
    Tab,
    Heading(HeadingNode),
}
pub(crate) struct Construction {
    class: u32,
    instance: u32,
    base: BaseData,
    payload: Payload,
    runtime: Arc<InstanceRuntime>,
}
impl Construction {
    pub fn execute(
        self,
        tx: &mut Transaction<'_>,
        ticket: ForeignReservedKey,
    ) -> Result<NodeKey, Error> {
        self.runtime.claim_instance(self.instance)?;
        let instance = ForeignInstance::new(
            tx.view().foreign_instance_owner(),
            self.class,
            self.instance,
        )?;
        Ok(match self.payload {
            Payload::Text => tx
                .create_reserved_with_instance(ticket, Text::default(), self.base, instance)?
                .key(),
            Payload::Paragraph => tx
                .create_reserved_with_instance(ticket, Paragraph::default(), self.base, instance)?
                .key(),
            Payload::LineBreak => tx
                .create_reserved_with_instance(ticket, LineBreak::default(), self.base, instance)?
                .key(),
            Payload::Tab => tx
                .create_reserved_with_instance(ticket, Tab::default(), self.base, instance)?
                .key(),
            Payload::Heading(node) => tx
                .create_reserved_with_instance(ticket, node, self.base, instance)?
                .key(),
        })
    }
}
impl InstanceRuntime {
    pub fn prepare_construction(
        self: &Arc<Self>,
        operation: compat::CompatOperation,
        seed: &compat::CompatInstanceSeed,
    ) -> Result<Construction, BoundaryError> {
        let compat::CompatInstanceSeed::CompatCreatedInstance {
            instance_owner_id,
            class_id,
            instance_id,
            base,
            native_projection,
            own_fields,
        } = seed
        else {
            return Err(BoundaryError::Invalid("constructed instance seed required"));
        };
        if *instance_owner_id != self.editor
            || *instance_id == 0
            || matches!(
                own_fields,
                compat::ForeignOpaqueValue::Unknown
                    | compat::ForeignOpaqueValue::ForeignSlot { slot_id: 0 }
            )
        {
            return Err(BoundaryError::Invalid("constructor instance namespace"));
        }
        let class = self
            .classes
            .get(class_id)
            .ok_or(BoundaryError::Invalid("unregistered constructor class"))?;
        let expected = match operation {
            compat::CompatOperation::CreateText => "text",
            compat::CompatOperation::CreateParagraph => "paragraph",
            compat::CompatOperation::CreateLineBreak => "linebreak",
            compat::CompatOperation::CreateTab => "tab",
            compat::CompatOperation::CreateHeading => "heading",
            compat::CompatOperation::CreateRegisteredNode => class.type_name.as_str(),
            _ => return Err(BoundaryError::Invalid("constructor operation required")),
        };
        if class.type_name != expected || class.native_type != expected || expected == "root" {
            return Err(BoundaryError::Invalid("constructor class storage mismatch"));
        }
        let initial = match class.kind {
            compat::ForeignNodeKind::Text => BaseData::Text(TextData::default()),
            compat::ForeignNodeKind::Element => BaseData::Element(ElementData::default()),
            compat::ForeignNodeKind::LineBreak => BaseData::LineBreak,
            _ => return Err(BoundaryError::Invalid("constructor storage kind")),
        };
        let base = codec::base(&initial, base.clone())?;
        let patch = codec::projection(expected, native_projection.clone())?;
        let payload = match expected {
            "text" => Payload::Text,
            "paragraph" => Payload::Paragraph,
            "linebreak" => Payload::LineBreak,
            "tab" => Payload::Tab,
            "heading" => {
                let mut node = HeadingNode {
                    tag: HeadingTagType::H1,
                };
                if let Some(patch) = patch {
                    patch.apply(&mut node)?;
                }
                Payload::Heading(node)
            }
            _ => {
                return Err(BoundaryError::Invalid(
                    "constructor payload codec is not installed",
                ))
            }
        };
        Ok(Construction {
            class: *class_id,
            instance: *instance_id,
            base,
            payload,
            runtime: self.clone(),
        })
    }
}
