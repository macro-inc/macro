//! Clone acknowledgements patch independent scalar/native data, never graph links.
use super::*;
use std::any::Any;

pub(super) fn validate_storage(
    class: &compat::ForeignClassRegistration,
    prototype: compat::CompatNativePrototype,
) -> Result<(), BoundaryError> {
    use compat::{CompatNativePrototype as P, ForeignNodeKind as K};
    let (expected, kind) = match class.native_type.as_str() {
        "root" => (P::RootNode, K::Element),
        "paragraph" => (P::ParagraphNode, K::Element),
        "text" => (P::TextNode, K::Text),
        "tab" => (P::TabNode, K::Text),
        "linebreak" => (P::LineBreakNode, K::LineBreak),
        "heading" => (P::HeadingNode, K::Element),
        _ => {
            return Err(BoundaryError::Invalid(
                "hosted native storage codec is not installed",
            ))
        }
    };
    if class.type_name != class.native_type || prototype != expected || class.kind != kind {
        return Err(BoundaryError::Invalid(
            "hosted native storage descriptor mismatch",
        ));
    }
    Ok(())
}
fn required<T>(value: Option<T>) -> Result<T, Error> {
    value.ok_or(Error::Invariant("incomplete clone base acknowledgement"))
}
pub(super) fn base(source: &BaseData, patch: compat::ForeignBasePatch) -> Result<BaseData, Error> {
    let mut base = source.clone();
    let fields = match source {
        BaseData::Text(_) => {
            if patch.element.is_some() {
                return Err(Error::Invariant("element patch on text clone"));
            }
            let data = required(patch.text)?;
            vec![
                ForeignBaseField::Text(
                    String::from_utf16(&required(data.text)?)
                        .map_err(|_| Error::Invariant("invalid clone text UTF-16"))?,
                ),
                ForeignBaseField::Format(required(data.format)?),
                ForeignBaseField::Detail(required(data.detail)?),
                ForeignBaseField::Mode(match required(data.mode)? {
                    0 => TextMode::Normal,
                    1 => TextMode::Token,
                    2 => TextMode::Segmented,
                    _ => return Err(Error::Invariant("invalid clone text mode")),
                }),
                ForeignBaseField::Style(required(data.style)?.into()),
            ]
        }
        BaseData::Element(_) => {
            if patch.text.is_some() {
                return Err(Error::Invariant("text patch on element clone"));
            }
            let data = required(patch.element)?;
            vec![
                ForeignBaseField::Format(required(data.format)?),
                ForeignBaseField::Indent(required(data.indent)?),
                ForeignBaseField::Direction(match required(data.direction)? {
                    0 => None,
                    1 => Some(TextDirection::Ltr),
                    2 => Some(TextDirection::Rtl),
                    _ => return Err(Error::Invariant("invalid clone element direction")),
                }),
                ForeignBaseField::TextFormat(required(data.text_format)?),
                ForeignBaseField::TextStyle(required(data.text_style)?.into()),
                ForeignBaseField::Style(required(data.style)?.into()),
            ]
        }
        _ => {
            if patch.text.is_some() || patch.element.is_some() {
                return Err(Error::Invariant("unexpected clone scalar base"));
            }
            vec![]
        }
    };
    for field in fields {
        base = field.apply_owned(base)?;
    }
    Ok(base)
}
fn optional(key: compat::ForeignOptionalKey) -> Option<NodeKey> {
    key.present.then(|| {
        NodeKey::from_parts(KeyParts {
            index: key.key.index,
            generation: key.key.generation,
        })
    })
}
pub(super) fn links(links: compat::ForeignTreeLinks) -> Result<ForeignCloneLinks, Error> {
    Ok(ForeignCloneLinks {
        parent: optional(links.parent),
        previous: optional(links.previous),
        next: optional(links.next),
        first: optional(links.first),
        last: optional(links.last),
        size: links.size,
    })
}
struct HeadingPatch(lexical_rich_nodes::heading::HeadingTagType);
impl ForeignPayloadPatch for HeadingPatch {
    fn apply(&self, payload: &mut dyn Any) -> Result<(), Error> {
        let heading = payload
            .downcast_mut::<lexical_rich_nodes::heading::HeadingNode>()
            .ok_or(Error::Invariant("heading clone payload mismatch"))?;
        heading.tag = self.0;
        Ok(())
    }
}
pub(super) fn projection(
    type_name: &str,
    patch: compat::ForeignNativeProjection,
) -> Result<Option<Box<dyn ForeignPayloadPatch>>, Error> {
    if patch.native_type != type_name || !patch.complete {
        return Err(Error::Invariant("incomplete native clone projection"));
    }
    if type_name != "heading" {
        if !patch.fields.is_empty() {
            return Err(Error::Invariant("unexpected clone native fields"));
        }
        return Ok(None);
    }
    if patch.fields.len() != 1
        || patch.fields[0].field != compat::ForeignNativeField::HeadingNodeTag
    {
        return Err(Error::Invariant("invalid heading clone projection"));
    }
    let compat::ForeignCallbackValue::ForeignStringArgument { value } = &patch.fields[0].value
    else {
        return Err(Error::Invariant("invalid heading clone tag"));
    };
    use lexical_rich_nodes::heading::HeadingTagType as Tag;
    let tag = match String::from_utf16(value)
        .map_err(|_| Error::Invariant("invalid heading clone tag"))?
        .as_str()
    {
        "h1" => Tag::H1,
        "h2" => Tag::H2,
        "h3" => Tag::H3,
        "h4" => Tag::H4,
        "h5" => Tag::H5,
        "h6" => Tag::H6,
        _ => return Err(Error::Invariant("invalid heading clone tag")),
    };
    Ok(Some(Box::new(HeadingPatch(tag))))
}
