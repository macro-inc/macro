//! Standard transformers used with the portable engine.
pub mod block;
pub mod code;
pub use code::*;
pub mod link;
pub mod list;
use crate::*;
pub use block::*;
use lexical_model::TextFormatType;
pub use link::*;
pub use list::*;
use std::{borrow::Cow::Borrowed as B, sync::Arc};
/// Standard inline code format.
pub static INLINE_CODE: TextFormatTransformer = TextFormatTransformer {
    format: B(&[TextFormatType::Code]),
    tag: B("`"),
    intraword: true,
};
/// Standard highlight format.
pub static HIGHLIGHT: TextFormatTransformer = TextFormatTransformer {
    format: B(&[TextFormatType::Highlight]),
    tag: B("=="),
    intraword: true,
};
/// Standard bold italic star format.
pub static BOLD_ITALIC_STAR: TextFormatTransformer = TextFormatTransformer {
    format: B(&[TextFormatType::Bold, TextFormatType::Italic]),
    tag: B("***"),
    intraword: true,
};
/// Standard bold italic underscore format.
pub static BOLD_ITALIC_UNDERSCORE: TextFormatTransformer = TextFormatTransformer {
    format: B(&[TextFormatType::Bold, TextFormatType::Italic]),
    tag: B("___"),
    intraword: false,
};
/// Standard bold star format.
pub static BOLD_STAR: TextFormatTransformer = TextFormatTransformer {
    format: B(&[TextFormatType::Bold]),
    tag: B("**"),
    intraword: true,
};
/// Standard bold underscore format.
pub static BOLD_UNDERSCORE: TextFormatTransformer = TextFormatTransformer {
    format: B(&[TextFormatType::Bold]),
    tag: B("__"),
    intraword: false,
};
/// Standard strikethrough format.
pub static STRIKETHROUGH: TextFormatTransformer = TextFormatTransformer {
    format: B(&[TextFormatType::Strikethrough]),
    tag: B("~~"),
    intraword: true,
};
/// Standard italic star format.
pub static ITALIC_STAR: TextFormatTransformer = TextFormatTransformer {
    format: B(&[TextFormatType::Italic]),
    tag: B("*"),
    intraword: true,
};
/// Standard italic underscore format.
pub static ITALIC_UNDERSCORE: TextFormatTransformer = TextFormatTransformer {
    format: B(&[TextFormatType::Italic]),
    tag: B("_"),
    intraword: false,
};
/// Upstream element group, excluding opt-in checklist.
pub fn element_transformers() -> Vec<Transformer> {
    vec![
        Transformer::Element(Arc::new(Heading)),
        Transformer::Element(Arc::new(Quote)),
        Transformer::Element(Arc::new(UnorderedList)),
        Transformer::Element(Arc::new(OrderedList)),
    ]
}
/// Ordered inline format group, with longest delimiters first.
pub fn text_format_transformers() -> Vec<Transformer> {
    [
        &INLINE_CODE,
        &BOLD_ITALIC_STAR,
        &BOLD_ITALIC_UNDERSCORE,
        &BOLD_STAR,
        &BOLD_UNDERSCORE,
        &HIGHLIGHT,
        &ITALIC_STAR,
        &ITALIC_UNDERSCORE,
        &STRIKETHROUGH,
    ]
    .into_iter()
    .map(|t| Transformer::TextFormat(t.clone()))
    .collect()
}
/// Standard inline structural group.
pub fn text_match_transformers() -> Vec<Transformer> {
    vec![Transformer::TextMatch(Arc::new(Link))]
}

/// Upstream multiline group.
pub fn multiline_element_transformers() -> Vec<Transformer> {
    vec![Transformer::MultilineElement(Arc::new(Code))]
}
/// Complete upstream default ordering; checklists remain opt-in.
pub fn transformers() -> Vec<Transformer> {
    element_transformers()
        .into_iter()
        .chain(multiline_element_transformers())
        .chain(text_format_transformers())
        .chain(text_match_transformers())
        .collect()
}
/// Reusable upstream default registry.
pub static TRANSFORMERS: std::sync::LazyLock<Transformers> =
    std::sync::LazyLock::new(|| Transformers::new(transformers()));
