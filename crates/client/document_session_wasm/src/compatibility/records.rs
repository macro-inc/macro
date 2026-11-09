//! Typed captures never serialize public JS node objects or invoke their getters.
use super::*;
use lexical_model::*;

pub(super) struct CaptureOptions<'a> {
    pub writable: &'a [NodeKey],
    pub include_root_cache: bool,
}

pub(super) struct Capture {
    pub reference: compat::ForeignRecordRef,
    pub source: Arc<ForeignReadSnapshot>,
    pub identity: ForeignRecordIdentity,
    pub output: compat::ForeignRenderRecord,
    pub retired: bool,
}
pub(super) fn key(key: NodeKey) -> compat::ForeignKey {
    compat::ForeignKey {
        index: key.index(),
        generation: key.generation(),
    }
}
pub(super) fn optional(value: Option<NodeKey>) -> compat::ForeignOptionalKey {
    compat::ForeignOptionalKey {
        present: value.is_some(),
        key: key(value.unwrap_or(NodeKey::ROOT)),
    }
}
pub(super) fn base_patch(value: &BaseData) -> compat::ForeignBasePatch {
    match value {
        BaseData::Text(data) => compat::ForeignBasePatch {
            text: Some(compat::ForeignTextBase {
                text: Some(data.text.as_str().encode_utf16().collect()),
                format: Some(data.format.bits()),
                detail: Some(data.detail.bits()),
                mode: Some(match data.mode {
                    TextMode::Normal => 0,
                    TextMode::Token => 1,
                    TextMode::Segmented => 2,
                }),
                style: Some(data.style.to_string()),
            }),
            element: None,
        },
        BaseData::Element(data) => compat::ForeignBasePatch {
            text: None,
            element: Some(compat::ForeignElementBase {
                format: Some(data.format.bits()),
                indent: Some(data.indent),
                direction: Some(match data.direction {
                    None => 0,
                    Some(TextDirection::Ltr) => 1,
                    Some(TextDirection::Rtl) => 2,
                }),
                text_format: Some(data.text_format.bits()),
                text_style: Some(data.text_style.to_string()),
                style: Some(data.style.to_string()),
            }),
        },
        _ => compat::ForeignBasePatch {
            text: None,
            element: None,
        },
    }
}

struct RecordScope {
    version: u64,
    update: u32,
    access: compat::ForeignAccess,
    retired: bool,
}

impl Host {
    pub(super) fn records(
        &mut self,
        source: Arc<ForeignReadSnapshot>,
        keys: Vec<NodeKey>,
        version: u64,
        update: u32,
        access: compat::ForeignAccess,
        options: CaptureOptions<'_>,
    ) -> Result<Vec<compat::ForeignRenderRecord>, BoundaryError> {
        let records = source.render_records(keys)?;
        self.encode_records(
            source,
            records,
            options,
            RecordScope {
                version,
                update,
                access,
                retired: false,
            },
        )
    }
    pub(super) fn retired_records(
        &mut self,
        source: Arc<ForeignReadSnapshot>,
        keys: Vec<NodeKey>,
        version: u64,
        update: u32,
    ) -> Result<Vec<compat::ForeignRenderRecord>, BoundaryError> {
        let records = source.render_retired_records(keys)?;
        self.encode_records(
            source,
            records,
            CaptureOptions {
                writable: &[],
                include_root_cache: false,
            },
            RecordScope {
                version,
                update,
                access: compat::ForeignAccess::Read,
                retired: true,
            },
        )
    }
    fn encode_records(
        &mut self,
        source: Arc<ForeignReadSnapshot>,
        records: Vec<lexical_model::ForeignRenderRecord>,
        options: CaptureOptions<'_>,
        scope: RecordScope,
    ) -> Result<Vec<compat::ForeignRenderRecord>, BoundaryError> {
        let RecordScope {
            version,
            update,
            access,
            retired,
        } = scope;
        let writable: std::collections::HashSet<_> = options.writable.iter().copied().collect();
        records
            .into_iter()
            .map(|record| {
                let node = record.record();
                let instance = node.foreign_instance();
                if instance.as_ref().is_some_and(|instance| {
                    !self.owner_aliases.contains(&instance.owner().downgrade())
                }) {
                    return Err(BoundaryError::Invalid(
                        "unregistered foreign instance owner",
                    ));
                }
                let reference = compat::ForeignRecordRef {
                    node: compat::ForeignNodeRef {
                        editor_id: self.editor,
                        version,
                        key: key(node.key()),
                        instance_owner_id: instance.as_ref().map_or(0, |_| self.editor),
                        class_id: instance.as_ref().map_or(0, ForeignInstance::class_id),
                        instance_id: instance.as_ref().map_or(0, ForeignInstance::instance_id),
                    },
                    update_id: update,
                    access: if access == compat::ForeignAccess::Writable
                        && !writable.contains(&node.key())
                    {
                        compat::ForeignAccess::Frozen
                    } else {
                        access
                    },
                    capture_id: self.next_capture,
                };
                let root_cache = options
                    .include_root_cache
                    .then(|| record.root_cached_text())
                    .flatten();
                let capture_key = capture_index::CaptureKey::new(
                    reference,
                    record.identity().clone(),
                    root_cache.is_some(),
                    retired,
                );
                if let Some(id) = self.capture_index.get(&capture_key) {
                    let capture = self
                        .captures
                        .get(&id)
                        .ok_or(BoundaryError::Invalid("capture index mismatch"))?;
                    self.capture_leases.emit(capture.reference)?;
                    return Ok(capture.output.clone());
                }
                self.next_capture = self
                    .next_capture
                    .checked_add(1)
                    .ok_or(BoundaryError::Invalid("capture identity exhausted"))?;
                let base = base_patch(record.base());
                let links = record.links();
                let native_type = record.native_type().unwrap_or("").to_owned();
                let mut projection = compat::ForeignNativeProjection {
                    complete: matches!(
                        native_type.as_str(),
                        "root" | "text" | "paragraph" | "tab" | "linebreak"
                    ),
                    native_type,
                    fields: vec![],
                };
                if let Some(heading) = record.native::<lexical_rich_nodes::heading::HeadingNode>() {
                    let tag = match heading.tag {
                        lexical_rich_nodes::heading::HeadingTagType::H1 => "h1",
                        lexical_rich_nodes::heading::HeadingTagType::H2 => "h2",
                        lexical_rich_nodes::heading::HeadingTagType::H3 => "h3",
                        lexical_rich_nodes::heading::HeadingTagType::H4 => "h4",
                        lexical_rich_nodes::heading::HeadingTagType::H5 => "h5",
                        lexical_rich_nodes::heading::HeadingTagType::H6 => "h6",
                    };
                    projection.fields.push(compat::ForeignNativeFieldValue {
                        field: compat::ForeignNativeField::HeadingNodeTag,
                        value: compat::ForeignCallbackValue::ForeignStringArgument {
                            value: tag.encode_utf16().collect(),
                        },
                    });
                    projection.complete = true;
                }
                let output = compat::ForeignRenderRecord {
                    record: reference,
                    has_instance: instance.is_some(),
                    type_index: u32::from(node.type_index().get()),
                    type_name: node.type_name().into(),
                    kind: match node.kind() {
                        NodeKind::Element => compat::ForeignNodeKind::Element,
                        NodeKind::Text => compat::ForeignNodeKind::Text,
                        NodeKind::Decorator => compat::ForeignNodeKind::Decorator,
                        NodeKind::LineBreak => compat::ForeignNodeKind::LineBreak,
                    },
                    base,
                    links: compat::ForeignTreeLinks {
                        parent: optional(links.parent),
                        previous: optional(links.previous),
                        next: optional(links.next),
                        first: optional(links.first),
                        last: optional(links.last),
                        size: links.size,
                    },
                    native_projection: projection,
                    has_root_cached_text: root_cache.is_some(),
                    root_cached_text: root_cache.unwrap_or("").encode_utf16().collect(),
                };
                self.capture_leases.emit(reference)?;
                self.capture_index.insert(capture_key, reference.capture_id);
                self.captures.insert(
                    reference.capture_id,
                    Capture {
                        reference,
                        source: source.clone(),
                        identity: record.identity().clone(),
                        output: output.clone(),
                        retired,
                    },
                );
                Ok(output)
            })
            .collect()
    }
    pub(super) fn batch(
        &mut self,
        state: &EditorState,
        version: u64,
    ) -> Result<compat::ForeignRenderBatch, BoundaryError> {
        let source = Arc::new(state.view().snapshot_for_foreign_read()?);
        let keys = source.record_keys();
        Ok(compat::ForeignRenderBatch {
            editor_id: self.editor,
            update_id: 0,
            version,
            full_reconcile: true,
            records: self.records(
                source,
                keys,
                version,
                0,
                compat::ForeignAccess::Frozen,
                CaptureOptions {
                    writable: &[],
                    include_root_cache: true,
                },
            )?,
            removed_keys: vec![],
        })
    }
    pub(super) fn selection(
        &mut self,
        source: &ForeignReadSnapshot,
        version: u64,
    ) -> Result<compat::CompatSelectionData, BoundaryError> {
        let Some(selection) = source.state().selection() else {
            return Ok(compat::CompatSelectionData::CompatNoSelection {});
        };
        let identity = source
            .selection_identity()
            .ok_or(BoundaryError::Invalid("selection identity"))?;
        self.selection_values.capture(
            selection,
            identity.clone(),
            version,
            if self.pending_version == Some(version) {
                selection_values::Origin::Active {
                    update: self.update,
                }
            } else {
                selection_values::Origin::Frozen
            },
        )
    }
}
