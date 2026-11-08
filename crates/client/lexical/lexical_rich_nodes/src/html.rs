//! Rich node exportDOM implementations over the portable HTML builder.
use crate::{
    code::{CodeHighlightNode, CodeNode},
    hashtag::HashtagNode,
    heading::{HeadingNode, HeadingTagType},
    link::{AutoLinkNode, LinkNode},
    mark::MarkNode,
    overflow::OverflowNode,
    quote::QuoteNode,
};
use lexical_html::{css::*, nodes::*, *};
use lexical_model::{NodeKey, Read};
mod list;
mod table;
/// Register all exact rich-node export types; core types are registered separately.
pub fn register_rich_nodes_html(builder: ExportRegistryBuilder) -> ExportRegistryBuilder {
    builder
        .node::<HeadingNode>()
        .node::<QuoteNode>()
        .node::<CodeNode>()
        .node::<CodeHighlightNode>()
        .node::<LinkNode>()
        .node::<AutoLinkNode>()
        .node::<MarkNode>()
        .node::<OverflowNode>()
        .node::<HashtagNode>()
        .node::<crate::list::ListNode>()
        .node::<crate::list::ListItemNode>()
        .node::<crate::table::TableNode>()
        .node::<crate::table::TableRowNode>()
        .node::<crate::table::TableCellNode>()
}
impl ExportDom for HeadingNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        let (tag, class) = match self.tag {
            HeadingTagType::H1 => ("h1", &ctx.theme.heading.h1),
            HeadingTagType::H2 => ("h2", &ctx.theme.heading.h2),
            HeadingTagType::H3 => ("h3", &ctx.theme.heading.h3),
            HeadingTagType::H4 => ("h4", &ctx.theme.heading.h4),
            HeadingTagType::H5 => ("h5", &ctx.theme.heading.h5),
            HeadingTagType::H6 => ("h6", &ctx.theme.heading.h6),
        };
        block_export_dom(ctx, key, tag, class.as_deref())
    }
}
impl ExportDom for QuoteNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        block_export_dom(ctx, key, "blockquote", ctx.theme.quote.as_deref())
    }
}
impl ExportDom for CodeNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        let mut el = HtmlElement::new("pre");
        add_class_names(&mut el, &[ctx.theme.code.as_deref()]);
        el.set_attribute("spellcheck", "false");
        if let Some(language) = self.language().filter(|s| !s.is_empty()) {
            el.set_attribute("data-language", language);
        }
        if let Some(theme) = self.theme().filter(|s| !s.is_empty()) {
            el.set_attribute("data-theme", theme);
        }
        set_dom_style_from_css(&mut el, &ctx.state.element_data(key)?.style);
        Ok(DomExportOutput::element(el))
    }
}
impl ExportDom for CodeHighlightNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        let mut el = text_create_dom(ctx, key)?;
        if let Some(class) = self
            .highlight_type
            .as_ref()
            .and_then(|kind| ctx.theme.code_highlight.get(kind))
        {
            add_class_names(&mut el, &[Some(class)]);
        }
        Ok(DomExportOutput::node(text_export_dom(ctx, key, el)?))
    }
}
/// Shared link output for application subclasses.
pub fn link_export_dom<'a>(
    link: &LinkNode,
    ctx: &ExportCtx<'a>,
    key: NodeKey,
    unlinked: bool,
) -> lexical_html::Result<DomExportOutput<'a>> {
    let mut el = HtmlElement::new(if unlinked { "span" } else { "a" });
    if !unlinked {
        el.set_attribute(
            "href",
            lexical_html::js::decode_uri(&crate::link::sanitize_url(&link.url))?,
        );
        for (name, value) in [
            ("target", &link.target),
            ("rel", &link.rel),
            ("title", &link.title),
        ] {
            if let Some(value) = value.as_ref().filter(|s| !s.is_empty()) {
                el.set_attribute(name, value);
            }
        }
        add_class_names(&mut el, &[ctx.theme.link.as_deref()]);
    }
    element_export_dom(ctx, key, &mut el)?;
    Ok(DomExportOutput::element(el))
}
impl ExportDom for LinkNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        link_export_dom(self, ctx, key, false)
    }
}
impl ExportDom for AutoLinkNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        link_export_dom(&self.link, ctx, key, self.is_unlinked)
    }
}
impl ExportDom for MarkNode {
    fn export_dom<'a>(
        &'a self,
        _: &ExportCtx<'a>,
        _: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        Ok(DomExportOutput::element(HtmlElement::new("mark")))
    }
}
impl ExportDom for OverflowNode {
    fn export_dom<'a>(
        &'a self,
        _: &ExportCtx<'a>,
        _: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        Ok(DomExportOutput::element(HtmlElement::new("span")))
    }
}
impl ExportDom for HashtagNode {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> lexical_html::Result<DomExportOutput<'a>> {
        Ok(DomExportOutput::node(text_export_dom(
            ctx,
            key,
            text_create_dom(ctx, key)?,
        )?))
    }
}
