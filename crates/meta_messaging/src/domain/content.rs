//! Bounded display content: inert text and validated, provider-supplied public links.

/// A public content link validated by the provider normalizer.
pub struct SuppliedLink<'a>(pub(crate) &'a str);
impl<'a> SuppliedLink<'a> {
    /// Already-validated URL, never an attachment download destination.
    pub fn as_str(&self) -> &'a str {
        self.0
    }
}

/// One display line. Plain text must be escaped by the native renderer.
pub enum ContentLine<'a> {
    /// Untrusted provider text, with no Macro markdown interpretation.
    Text(&'a str),
    /// An authentic public destination supplied in supported provider content.
    Link(SuppliedLink<'a>),
}

/// Provider interpretation, kept separate from native rendering and source identity.
pub struct NormalizedContent<'a> {
    /// Bounded lines from the already-bounded decoded message.
    pub lines: Vec<ContentLine<'a>>,
    /// Exact old plain-text bodies eligible for source-scoped placeholder repair.
    pub legacy_placeholders: Vec<String>,
}
