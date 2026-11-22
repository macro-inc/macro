//! Portable DOM-first UTF-16 splices; unchanged text stays on the native side.
use crate::*;

/// A view edit relative to its last applied model text.
#[derive(Clone, Debug, PartialEq)]
pub struct ViewTextDelta {
    /// Text origin.
    pub key: NodeKey,
    /// UTF-16 position of the first changed code unit.
    pub offset: Utf16Offset,
    /// UTF-16 length removed at the position.
    pub deleted: Utf16Offset,
    /// Inserted text without the unchanged prefix or suffix.
    pub inserted: String,
    /// Optional UTF-16 anchor after the edit.
    pub anchor: Option<Utf16Offset>,
    /// Optional UTF-16 focus after the edit.
    pub focus: Option<Utf16Offset>,
    /// Whether this edit terminates composition.
    pub composition_end: bool,
    /// Optional final composition data.
    pub composition_data: Option<String>,
    /// Resolved view selection after the edit.
    pub selection: ViewSelection,
}
impl ViewTextDelta {
    fn byte_range(&self, old: &TextBuffer) -> Result<std::ops::Range<usize>, Error> {
        let end = self
            .offset
            .checked_add(self.deleted)
            .ok_or(Error::Utf16OffsetOutOfRange(Utf16Offset(u32::MAX)))?;
        Ok(old.byte_offset(self.offset)?..old.byte_offset(end)?)
    }
    pub(crate) fn is_unchanged(&self, view: StateRef<'_>) -> Result<bool, Error> {
        let old = &view.text_data(self.key)?.text;
        Ok(old.as_str()[self.byte_range(old)?] == self.inserted)
    }
    /// Reconstruct the displayed text, rejecting invalid UTF-16 boundaries atomically.
    pub fn displayed_text(&self, view: StateRef<'_>) -> Result<String, Error> {
        let old = &view.text_data(self.key)?.text;
        let range = self.byte_range(old)?;
        let (start, end) = (range.start, range.end);
        let mut displayed =
            String::with_capacity(old.as_str().len() - (end - start) + self.inserted.len());
        displayed.push_str(&old.as_str()[..start]);
        displayed.push_str(&self.inserted);
        displayed.push_str(&old.as_str()[end..]);
        Ok(displayed)
    }
}

#[cfg(test)]
#[path = "view_text_delta/test.rs"]
mod test;
