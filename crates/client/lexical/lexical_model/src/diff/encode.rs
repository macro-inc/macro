//! Versioned flat word/string layout, S1 §11.3.
use super::*;
/// Current flat diff format.
pub const DIFF_FORMAT_VERSION: u32 = 1;
/// Sentinel for a missing key.
pub const DIFF_NONE: u32 = u32::MAX;
/// Stable opcode values shared with boundary decoders.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, strum::EnumIter, strum::IntoStaticStr)]
#[repr(u32)]
pub enum DiffOpcode {
    /// REMOVE.
    Remove = 1,
    /// CREATE_ELEMENT.
    CreateElement = 2,
    /// CREATE_TEXT.
    CreateText = 3,
    /// CREATE_DECORATOR.
    CreateDecorator = 4,
    /// CREATE_LINE_BREAK.
    CreateLineBreak = 5,
    /// CHILDREN.
    Children = 6,
    /// TEXT.
    Text = 7,
    /// TEXT_PROPS.
    TextProps = 8,
    /// ELEMENT_PROPS.
    ElementProps = 9,
    /// NODE_PROPS.
    NodeProps = 10,
    /// STATE.
    State = 11,
    /// SET_DECORATOR_REVISION: key, low32, high32.
    SetDecoratorRevision = 12,
}
/// Reusable aligned word buffer and compact UTF-8 string table.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DiffBuffer {
    /// Header, opcodes and payloads.
    pub words: Vec<u32>,
    /// Concatenated UTF-8 bytes.
    pub strings: Vec<u8>,
}
impl DiffBuffer {
    fn header(&mut self, generation: u32, full: bool, view_text_matches: Option<NodeKey>) {
        self.words.clear();
        self.strings.clear();
        self.words.extend([
            DIFF_FORMAT_VERSION,
            generation,
            u32::from(full),
            view_text_matches.map_or(DIFF_NONE, NodeKey::index),
            0,
        ]);
    }
    fn string(&mut self, text: &str) {
        if text.is_empty() {
            self.words.extend([0, 0]);
            return;
        }
        self.words
            .extend([self.strings.len() as u32, text.len() as u32]);
        self.strings.extend_from_slice(text.as_bytes());
    }
    fn json(&mut self, props: &SerializedNode) {
        if props.is_empty() {
            self.words.extend([0, 0]);
        } else {
            self.string(&to_js_json_string(&serde_json::Value::Object(
                props.clone(),
            )));
        }
    }
    fn text_fields(&mut self, props: &TextProps) {
        self.words.extend([
            props.format.bits(),
            match props.mode {
                TextMode::Normal => 0,
                TextMode::Token => 1,
                TextMode::Segmented => 2,
            },
            props.detail.bits(),
        ]);
    }
    fn element_fields(&mut self, props: &ElementProps) {
        self.words.extend([
            props.format.bits(),
            props.indent,
            match props.direction {
                None => 0,
                Some(TextDirection::Ltr) => 1,
                Some(TextDirection::Rtl) => 2,
            },
            props.text_format.bits(),
        ]);
        self.string(&props.style);
        self.string(&props.text_style);
    }
    fn op(&mut self, op: &DiffOp) {
        // The header always has five words before an operation can be appended.
        if let Some(count) = self.words.get_mut(4) {
            *count += 1;
        }
        match op {
            DiffOp::SetDecoratorRevision { key, revision } => {
                let bytes = revision.to_le_bytes();
                self.words.extend([
                    DiffOpcode::SetDecoratorRevision as u32,
                    key.index(),
                    u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
                    u32::from_le_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
                ]);
            }
            DiffOp::Remove { key, subtree_root } => self.words.extend([
                DiffOpcode::Remove as u32,
                key.index(),
                u32::from(*subtree_root),
            ]),
            DiffOp::CreateElement {
                key,
                type_index,
                base,
                props,
            } => {
                self.words.extend([
                    DiffOpcode::CreateElement as u32,
                    key.index(),
                    u32::from(type_index.0),
                ]);
                self.element_fields(base);
                self.json(props);
            }
            DiffOp::CreateText {
                key,
                type_index,
                text,
                base,
                props,
            } => {
                self.words.extend([
                    DiffOpcode::CreateText as u32,
                    key.index(),
                    u32::from(type_index.0),
                ]);
                self.text_fields(base);
                self.string(text);
                self.string(&base.style);
                self.json(props);
            }
            DiffOp::CreateDecorator {
                key,
                type_index,
                props,
            } => {
                self.words.extend([
                    DiffOpcode::CreateDecorator as u32,
                    key.index(),
                    u32::from(type_index.0),
                ]);
                self.json(props);
            }
            DiffOp::CreateLineBreak { key, type_index } => self.words.extend([
                DiffOpcode::CreateLineBreak as u32,
                key.index(),
                u32::from(type_index.0),
            ]),
            DiffOp::Children { parent, children } => {
                self.words.extend([
                    DiffOpcode::Children as u32,
                    parent.index(),
                    children.len() as u32,
                ]);
                self.words.extend(children.iter().map(|key| key.index()));
            }
            DiffOp::Text { key, text } => {
                self.words.extend([DiffOpcode::Text as u32, key.index()]);
                self.string(text);
            }
            DiffOp::TextProps { key, props } => {
                self.words
                    .extend([DiffOpcode::TextProps as u32, key.index()]);
                self.text_fields(props);
                self.string(&props.style);
            }
            DiffOp::ElementProps { key, props } => {
                self.words
                    .extend([DiffOpcode::ElementProps as u32, key.index()]);
                self.element_fields(props);
            }
            DiffOp::NodeProps { key, props } => {
                self.words
                    .extend([DiffOpcode::NodeProps as u32, key.index()]);
                self.json(props);
            }
            DiffOp::State { key, state } => {
                self.words.extend([DiffOpcode::State as u32, key.index()]);
                match state {
                    None => self.words.extend([0, 0]),
                    Some(state) => self.string(&to_js_json_string(&serde_json::Value::Object(
                        state.clone(),
                    ))),
                };
            }
        }
    }
}
impl Diff {
    /// Clear and reuse the output buffers, preserving operation order.
    pub fn encode(&self, buffer: &mut DiffBuffer) {
        buffer.header(self.generation, self.full_reconcile, self.view_text_matches);
        for op in &self.ops {
            buffer.op(op);
        }
    }
}
impl Commit {
    /// Encode the patch directly, without collecting an intermediate Diff or operation vector.
    pub fn encode_diff(&self, options: &DiffOptions, buffer: &mut DiffBuffer) -> Result<(), Error> {
        let last = self.chain().last().unwrap_or(self);
        buffer.header(
            last.next.max_key().generation(),
            self.chain().any(|c| c.full_reconcile),
            None,
        );
        self.visit_diff(options, |op| buffer.op(&op))
    }
}
