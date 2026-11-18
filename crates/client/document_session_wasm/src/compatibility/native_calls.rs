//! Authorized node operands are owned before executing model code or JS hooks.
use super::*;
use calls::{integer, string, text, undefined, ResultValue};
use compat::{CompatOperation as Op, ForeignCallbackValue as Value};
use lexical_model::*;

pub(super) struct NativeCall {
    pub request: compat::CompatRequest,
    pub receiver: Option<NodeKey>,
    pub nodes: Vec<NodeKey>,
}
impl NativeCall {
    fn node(&self) -> Result<NodeKey, BoundaryError> {
        self.nodes
            .first()
            .copied()
            .ok_or(BoundaryError::Invalid("authorized node argument required"))
    }
    pub fn execute(&self, tx: &mut Transaction<'_>) -> Result<ResultValue, BoundaryError> {
        let request = &self.request;
        let key = || {
            self.receiver
                .ok_or(BoundaryError::Invalid("compatibility receiver required"))
        };
        let arg = |index| request.args.get(index);
        Ok(match request.operation {
            Op::GetRoot => ResultValue::Node(Some(NodeKey::ROOT)),
            Op::GetNodeByKey => {
                let key = self.node()?;
                ResultValue::Node(tx.contains(key).then_some(key))
            }
            Op::CreateText => ResultValue::Node(Some(tx.create_text(&string(arg(0))?)?.key())),
            Op::CreateParagraph => ResultValue::Node(Some(tx.create(Paragraph::default())?.key())),
            Op::CreateLineBreak => ResultValue::Node(Some(tx.create(LineBreak::default())?.key())),
            Op::CreateTab => ResultValue::Node(Some(tx.create(Tab::default())?.key())),
            Op::CreateHeading => {
                let tag = match string(arg(0))?.as_str() {
                    "h1" => lexical_rich_nodes::heading::HeadingTagType::H1,
                    "h2" => lexical_rich_nodes::heading::HeadingTagType::H2,
                    "h3" => lexical_rich_nodes::heading::HeadingTagType::H3,
                    "h4" => lexical_rich_nodes::heading::HeadingTagType::H4,
                    "h5" => lexical_rich_nodes::heading::HeadingTagType::H5,
                    "h6" => lexical_rich_nodes::heading::HeadingTagType::H6,
                    _ => return Err(BoundaryError::Invalid("heading tag")),
                };
                ResultValue::Node(Some(
                    tx.create(lexical_rich_nodes::heading::HeadingNode { tag })?
                        .key(),
                ))
            }
            Op::GetLatest => {
                let key = key()?;
                tx.node_or_err(key)?;
                ResultValue::Node(Some(key))
            }
            Op::GetWritable => {
                let key = key()?;
                tx.mark_dirty(key)?;
                ResultValue::Node(Some(key))
            }
            Op::Append => {
                let nodes = &self.nodes;
                let key = key()?;
                tx.append(key, nodes)?;
                ResultValue::Node(Some(key))
            }
            Op::GetChildren => ResultValue::Nodes(tx.children_keys(key()?)?),
            Op::GetChildrenSize => ResultValue::Scalar(Value::ForeignNumberArgument {
                value: f64::from(tx.view().children_size(key()?)),
            }),
            Op::GetTextContent => ResultValue::Scalar(text(&tx.text_content(key()?))),
            Op::GetTextContentSize => ResultValue::Scalar(Value::ForeignNumberArgument {
                value: f64::from(tx.text_content_size(key()?).get()),
            }),
            Op::SetTextContent => {
                let key = key()?;
                tx.text(key)?.set_text_content(&string(arg(0))?)?;
                ResultValue::Node(Some(key))
            }
            Op::GetFirstChild => ResultValue::Node(tx.first_child(key()?)),
            Op::GetLastChild => ResultValue::Node(tx.last_child(key()?)),
            Op::GetParent => ResultValue::Node(tx.parent(key()?)),
            Op::GetPreviousSibling => ResultValue::Node(tx.prev_sibling(key()?)),
            Op::GetNextSibling => ResultValue::Node(tx.next_sibling(key()?)),
            Op::GetIndent => ResultValue::Scalar(Value::ForeignNumberArgument {
                value: f64::from(tx.indent(key()?)),
            }),
            Op::SetIndent => {
                let Some(Value::ForeignNumberArgument { value }) = arg(0) else {
                    return Err(BoundaryError::Invalid("indent argument"));
                };
                if !value.is_finite()
                    || *value < 0.0
                    || *value > f64::from(u32::MAX)
                    || value.fract() != 0.0
                {
                    return Err(BoundaryError::Invalid("indent range"));
                }
                let key = key()?;
                tx.set_indent(key, *value as u32)?;
                ResultValue::Node(Some(key))
            }
            Op::IsAttached => ResultValue::Scalar(Value::ForeignBooleanArgument {
                value: tx.is_attached(key()?),
            }),
            Op::IsInline => ResultValue::Scalar(Value::ForeignBooleanArgument {
                value: tx.is_inline(key()?),
            }),
            Op::SetNativeField => {
                let key = key()?;
                if !tx.foreign_is_writable(key) {
                    return Err(BoundaryError::Invalid("captured field is not writable"));
                }
                let field = string(arg(0))?;
                let patch = match field.as_str() {
                    "__text" => ForeignBaseField::Text(string(arg(1))?),
                    "__style" => ForeignBaseField::Style(string(arg(1))?.into()),
                    "__format" => ForeignBaseField::Format(integer(arg(1))?),
                    "__detail" => ForeignBaseField::Detail(integer(arg(1))?),
                    "__mode" => ForeignBaseField::Mode(match integer(arg(1))? {
                        0 => TextMode::Normal,
                        1 => TextMode::Token,
                        2 => TextMode::Segmented,
                        _ => return Err(BoundaryError::Invalid("text mode")),
                    }),
                    "__indent" => ForeignBaseField::Indent(integer(arg(1))?),
                    "__textFormat" => ForeignBaseField::TextFormat(integer(arg(1))?),
                    "__textStyle" => ForeignBaseField::TextStyle(string(arg(1))?.into()),
                    "__dir" => ForeignBaseField::Direction(match arg(1) {
                        Some(Value::ForeignOpaqueArgument {
                            value: compat::ForeignOpaqueValue::ForeignNull {},
                        }) => None,
                        _ => Some(match string(arg(1))?.as_str() {
                            "ltr" => TextDirection::Ltr,
                            "rtl" => TextDirection::Rtl,
                            _ => return Err(BoundaryError::Invalid("element direction")),
                        }),
                    }),
                    _ => return Err(BoundaryError::Invalid("unsupported native field patch")),
                };
                tx.patch_foreign_base(key, patch)?;
                ResultValue::Node(Some(key))
            }
            Op::GetSelection => ResultValue::Selection,
            Op::GetCompositionKey => ResultValue::Node(tx.composition_key()),
            Op::SetCompositionKey => {
                let key = match arg(0) {
                    Some(Value::ForeignOpaqueArgument {
                        value: compat::ForeignOpaqueValue::ForeignNull {},
                    }) => None,
                    _ => Some(self.node()?),
                };
                tx.set_composition_key(key)?;
                ResultValue::Scalar(undefined())
            }
            Op::AddUpdateTag => {
                tx.add_tag(
                    string(arg(0))?
                        .parse()
                        .expect("custom update tags are infallible"),
                );
                ResultValue::Scalar(undefined())
            }
            Op::ExportNodeJson => ResultValue::Scalar(text(&to_js_json_string(
                &serde_json::Value::Object(tx.export_json(key()?)?),
            ))),
            Op::ExportStateJson => ResultValue::Scalar(text(&to_js_json_string(
                &serde_json::to_value(tx.view().snapshot_for_foreign_read()?.state().to_json()?)?,
            ))),
            _ => {
                return Err(BoundaryError::Invalid(
                    "unsupported compatibility operation",
                ))
            }
        })
    }
}
