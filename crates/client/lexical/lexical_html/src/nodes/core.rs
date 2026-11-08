//! Core node exporters, implemented in the crate owning the export trait.
use crate::*;
use lexical_model::*;
impl ExportDom for Paragraph {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> crate::Result<DomExportOutput<'a>> {
        nodes::block_export_dom(ctx, key, "p", ctx.theme.paragraph.as_deref())
    }
}
impl ExportDom for Text {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> crate::Result<DomExportOutput<'a>> {
        Ok(DomExportOutput::node(nodes::text_export_dom(
            ctx,
            key,
            nodes::text_create_dom(ctx, key)?,
        )?))
    }
}
impl ExportDom for Tab {
    fn export_dom<'a>(
        &'a self,
        ctx: &ExportCtx<'a>,
        key: NodeKey,
    ) -> crate::Result<DomExportOutput<'a>> {
        let mut element = nodes::text_create_dom(ctx, key)?;
        css::add_class_names(&mut element, &[ctx.theme.tab.as_deref()]);
        Ok(DomExportOutput::node(nodes::text_export_dom(
            ctx, key, element,
        )?))
    }
}
impl ExportDom for LineBreak {
    fn export_dom<'a>(
        &'a self,
        _ctx: &ExportCtx<'a>,
        _key: NodeKey,
    ) -> crate::Result<DomExportOutput<'a>> {
        Ok(DomExportOutput::element(HtmlElement::new("br")))
    }
}
