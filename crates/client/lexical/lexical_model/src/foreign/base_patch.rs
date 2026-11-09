//! Scalar assignments on an already writable record do not rerun virtual setters.
use crate::*;
use std::sync::Arc;

/// One typed core-field assignment; structural links and payload fields are absent.
pub enum ForeignBaseField {
    /// Text content.
    Text(String),
    /// Text or element format number.
    Format(u32),
    /// Text or element style.
    Style(Arc<str>),
    /// Text normalization detail bits.
    Detail(u32),
    /// Text editing mode.
    Mode(TextMode),
    /// Element indentation.
    Indent(u32),
    /// Element direction.
    Direction(Option<TextDirection>),
    /// Element's default text format.
    TextFormat(u32),
    /// Element's default text style.
    TextStyle(Arc<str>),
}
impl Transaction<'_> {
    /// Assign a core field only after getWritable authorized this update record.
    /// Validation precedes installation; no virtual setter or extra semantic clone runs.
    pub fn patch_foreign_base(
        &mut self,
        key: NodeKey,
        field: ForeignBaseField,
    ) -> Result<(), Error> {
        self.guard_write()?;
        if !self.foreign_is_writable(key) {
            return Err(Error::Invariant("raw field requires a writable record"));
        }
        let mut base = self.node_or_err(key)?.base().clone();
        use crate::node::AbsentKeys;
        match (&mut base, field) {
            (BaseData::Text(data), ForeignBaseField::Text(text)) => {
                data.text = TextBuffer::new(text);
                data.absent.remove(AbsentKeys::TEXT);
            }
            (BaseData::Text(data), ForeignBaseField::Format(value)) => {
                data.format = TextFormat::from_bits_retain(value);
                data.absent.remove(AbsentKeys::field("format"));
            }
            (BaseData::Text(data), ForeignBaseField::Style(value)) => {
                data.style = value;
                data.absent.remove(AbsentKeys::field("style"));
            }
            (BaseData::Text(data), ForeignBaseField::Detail(value)) => {
                data.detail = TextDetail::from_bits_retain(value);
                data.absent.remove(AbsentKeys::field("detail"));
            }
            (BaseData::Text(data), ForeignBaseField::Mode(value)) => {
                data.mode = value;
                data.absent.remove(AbsentKeys::field("mode"));
            }
            (BaseData::Element(data), ForeignBaseField::Format(value)) => {
                data.format = ElementFormat::from_bits(value);
                data.absent.remove(AbsentKeys::field("format"));
            }
            (BaseData::Element(data), ForeignBaseField::Style(value)) => {
                data.style = value;
                data.absent.remove(AbsentKeys::field("style"));
            }
            (BaseData::Element(data), ForeignBaseField::Indent(value)) => {
                data.indent = value;
                data.absent.remove(AbsentKeys::field("indent"));
            }
            (BaseData::Element(data), ForeignBaseField::Direction(value)) => {
                data.direction = value;
                data.absent.remove(AbsentKeys::field("direction"));
            }
            (BaseData::Element(data), ForeignBaseField::TextFormat(value)) => {
                data.text_format = TextFormat::from_bits_retain(value);
                data.absent.remove(AbsentKeys::field("textFormat"));
            }
            (BaseData::Element(data), ForeignBaseField::TextStyle(value)) => {
                data.text_style = value;
                data.absent.remove(AbsentKeys::field("textStyle"));
            }
            _ => return Err(Error::Invariant("raw field does not match node kind")),
        }
        let record = self
            .pending
            .nodes
            .get_mut(&key)
            .ok_or(Error::NodeNotFound(key))?;
        Arc::make_mut(record).base = base;
        self.dirty_since_flush = true;
        Ok(())
    }
}
#[cfg(test)]
mod test;
