//! Notion blocks → Macro Markdown, the dialect Macro's Lexical transformers
//! import (`packages/lexical-core/transformers`).
//!
//! Conversion is pure: images are re-hosted and page links resolved before
//! rendering, so the same blocks and lookups always give the same Markdown.
//! Lexical has no toggle or nested-block quote, so toggles flatten to a bold
//! summary followed by their children, and quote/callout children render as
//! quoted lines.

use std::collections::{BTreeMap, HashMap};

use crate::domain::models::{
    NotionAnnotations, NotionBlock, NotionBlockKind, NotionFile, NotionId, NotionMention,
    NotionRichText, NotionRichTextKind,
};

#[cfg(test)]
mod test;

/// Indentation per nested list level (Macro's Lexical list indent).
const LIST_INDENT: &str = "  ";

/// A re-hosted image, in the form Macro's editor renders natively.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HostedImage {
    /// Static file service id.
    pub id: String,
    /// Static file service permalink.
    pub url: String,
    /// Natural width in pixels, when known.
    pub width: u32,
    /// Natural height in pixels, when known.
    pub height: u32,
}

/// A Notion page that already exists in Macro as a document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LinkedDocument {
    /// Macro document id.
    pub id: String,
    /// Its name.
    pub name: String,
}

/// What the converter knows beyond the blocks themselves.
#[derive(Debug, Default)]
pub(crate) struct ConvertContext<'a> {
    /// The page's Notion URL (for truncation and attachment links).
    pub page_url: &'a str,
    /// Re-hosted images by their Notion source URL. A Notion-hosted image
    /// missing here failed to re-host and becomes a link.
    pub images: HashMap<String, HostedImage>,
    /// Imported pages, which links to become in-app document mentions.
    pub documents: HashMap<NotionId, LinkedDocument>,
    /// Known titles of pages and databases, for links the blocks only name
    /// by id.
    pub titles: HashMap<NotionId, String>,
}

/// The rendered page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Converted {
    /// Macro Markdown.
    pub markdown: String,
    /// Omitted block types and how many of each (for a debug log).
    pub omitted: BTreeMap<String, usize>,
}

impl Converted {
    /// Whether the page converted to no body at all.
    pub fn is_empty(&self) -> bool {
        self.markdown.trim().is_empty()
    }
}

/// Every image URL in the tree, in document order, deduplicated.
pub(crate) fn image_files(blocks: &[NotionBlock]) -> Vec<NotionFile> {
    let mut files: Vec<NotionFile> = Vec::new();
    walk(blocks, &mut |block| {
        if let NotionBlockKind::Image { file, .. } = &block.kind
            && !files.iter().any(|seen| seen.url == file.url)
        {
            files.push(file.clone());
        }
    });
    files
}

fn walk<'a>(blocks: &'a [NotionBlock], visit: &mut impl FnMut(&'a NotionBlock)) {
    for block in blocks {
        visit(block);
        walk(&block.children, visit);
    }
}

/// Render a page's blocks. `truncated` appends a link to the rest of the
/// page in Notion.
pub(crate) fn convert(
    blocks: &[NotionBlock],
    truncated: bool,
    ctx: &ConvertContext<'_>,
) -> Converted {
    let mut renderer = Renderer {
        ctx,
        chunks: Vec::new(),
        omitted: BTreeMap::new(),
        in_quote: false,
    };
    renderer.blocks(blocks);
    if truncated {
        renderer.chunks.push(Chunk::Block(format!(
            "[Continue reading in Notion]({})",
            link_url(ctx.page_url)
        )));
    }
    Converted {
        markdown: join_chunks(&renderer.chunks),
        omitted: renderer.omitted,
    }
}

/// Output units: list lines stay on consecutive lines (one list), other
/// blocks are separated by a blank line.
#[derive(Debug)]
enum Chunk {
    ListLine(String),
    Block(String),
}

fn join_chunks(chunks: &[Chunk]) -> String {
    let mut out = String::new();
    let mut previous_was_list = false;
    for chunk in chunks {
        let (text, is_list) = match chunk {
            Chunk::ListLine(text) => (text, true),
            Chunk::Block(text) => (text, false),
        };
        if !out.is_empty() {
            out.push_str(if is_list && previous_was_list {
                "\n"
            } else {
                "\n\n"
            });
        }
        out.push_str(text);
        previous_was_list = is_list;
    }
    out
}

struct Renderer<'c, 'a> {
    ctx: &'c ConvertContext<'a>,
    chunks: Vec<Chunk>,
    omitted: BTreeMap<String, usize>,
    /// Rendering inside a quote, which holds inline content only: blocks
    /// Lexical parses as elements (images, tables, code fences) render as
    /// text lines instead.
    in_quote: bool,
}

impl Renderer<'_, '_> {
    /// Render sibling blocks at the top level.
    fn blocks(&mut self, blocks: &[NotionBlock]) {
        let mut number = 0;
        for block in blocks {
            number = match block.kind {
                NotionBlockKind::NumberedListItem(_) => number + 1,
                _ => 0,
            };
            self.block(block, number);
        }
    }

    fn block(&mut self, block: &NotionBlock, number: usize) {
        match &block.kind {
            NotionBlockKind::Paragraph(text) => {
                let text = self.inline(text, Escape::Text);
                if !text.trim().is_empty() {
                    self.chunks.push(Chunk::Block(text));
                }
                self.blocks(&block.children);
            }
            NotionBlockKind::Heading { level, text, .. } => {
                // Toggle headings flatten: the heading, then its children.
                let text = single_line(&self.inline(text, Escape::Text));
                if !text.trim().is_empty() {
                    self.chunks.push(Chunk::Block(format!(
                        "{} {}",
                        "#".repeat(usize::from((*level).clamp(1, 3))),
                        text
                    )));
                }
                self.blocks(&block.children);
            }
            NotionBlockKind::BulletedListItem(_)
            | NotionBlockKind::NumberedListItem(_)
            | NotionBlockKind::ToDo { .. } => self.list_item(block, 0, number),
            NotionBlockKind::Toggle(text) => {
                let bold: Vec<NotionRichText> = text
                    .iter()
                    .cloned()
                    .map(|mut run| {
                        run.annotations.bold = true;
                        run
                    })
                    .collect();
                let summary = single_line(&self.inline(&bold, Escape::Text));
                if !summary.trim().is_empty() {
                    self.chunks.push(Chunk::Block(summary));
                }
                self.blocks(&block.children);
            }
            NotionBlockKind::Quote(text) => {
                let quote = self.quoted(None, text, &block.children);
                if !quote.is_empty() {
                    self.chunks.push(Chunk::Block(quote));
                }
            }
            NotionBlockKind::Callout { text, icon_emoji } => {
                let quote = self.quoted(icon_emoji.as_deref(), text, &block.children);
                if !quote.is_empty() {
                    self.chunks.push(Chunk::Block(quote));
                }
            }
            NotionBlockKind::Code { text, language } => {
                let code: String = text.iter().map(|run| run.plain_text.as_str()).collect();
                if self.in_quote {
                    let lines: Vec<String> = code
                        .lines()
                        .filter(|line| !line.trim().is_empty())
                        .map(code_span)
                        .collect();
                    if !lines.is_empty() {
                        self.chunks.push(Chunk::Block(lines.join("\n")));
                    }
                } else {
                    self.chunks
                        .push(Chunk::Block(fenced_code(&code, &code_language(language))));
                }
            }
            NotionBlockKind::Divider if self.in_quote => {}
            NotionBlockKind::Divider => self.chunks.push(Chunk::Block("---".to_string())),
            NotionBlockKind::Equation(expression) => {
                if !expression.trim().is_empty() {
                    self.chunks
                        .push(Chunk::Block(katex(expression.trim(), false)));
                }
            }
            NotionBlockKind::Table { .. } if self.in_quote => {
                let rows: Vec<String> = block
                    .children
                    .iter()
                    .filter_map(|row| match &row.kind {
                        NotionBlockKind::TableRow(cells) => Some(
                            cells
                                .iter()
                                .map(|cell| single_line(&self.inline(cell, Escape::Text)))
                                .collect::<Vec<_>>()
                                .join(" · "),
                        ),
                        _ => None,
                    })
                    .filter(|row| !row.trim().is_empty())
                    .collect();
                if !rows.is_empty() {
                    self.chunks.push(Chunk::Block(rows.join("\n")));
                }
            }
            NotionBlockKind::Table {
                has_column_header, ..
            } => {
                if let Some(table) = self.table(&block.children, *has_column_header) {
                    self.chunks.push(Chunk::Block(table));
                }
            }
            NotionBlockKind::TableRow(_) => {
                // Rows only make sense inside their table.
                self.omit("table_row");
            }
            NotionBlockKind::ColumnList
            | NotionBlockKind::Column
            | NotionBlockKind::SyncedBlock { .. } => self.blocks(&block.children),
            NotionBlockKind::Image { file, caption } => {
                let alt = single_line(&plain(caption));
                let rendered = self.image(file, &alt);
                self.chunks.push(Chunk::Block(rendered));
            }
            NotionBlockKind::Attachment {
                kind,
                file,
                caption,
            } => {
                let label = Some(single_line(&plain(caption)))
                    .filter(|label| !label.trim().is_empty())
                    .or_else(|| file.name.clone().filter(|name| !name.trim().is_empty()))
                    .unwrap_or_else(|| attachment_noun(kind).to_string());
                // Notion-hosted file links expire after an hour; link to the
                // block in its page instead, which keeps working.
                let url = if file.hosted {
                    format!("{}#{}", self.ctx.page_url, block.id)
                } else {
                    file.url.clone()
                };
                self.chunks
                    .push(Chunk::Block(link(&label, &url, Escape::Text)));
            }
            NotionBlockKind::Link { url, caption } => {
                let label = Some(single_line(&plain(caption)))
                    .filter(|label| !label.trim().is_empty())
                    .unwrap_or_else(|| url.clone());
                self.chunks
                    .push(Chunk::Block(link(&label, url, Escape::Text)));
            }
            NotionBlockKind::ChildPage { title } => {
                let rendered = self.page_reference(&block.id, Some(title), Escape::Text);
                self.chunks.push(Chunk::Block(rendered));
            }
            NotionBlockKind::LinkToPage(id) => {
                let rendered = self.page_reference(id, None, Escape::Text);
                self.chunks.push(Chunk::Block(rendered));
            }
            NotionBlockKind::LinkToDatabase(id) => {
                let title = self.ctx.titles.get(id).cloned().unwrap_or_default();
                self.chunks.push(Chunk::Block(database_link(
                    &title,
                    &id.web_url(),
                    Escape::Text,
                )));
            }
            NotionBlockKind::ChildDatabase { title } => {
                self.chunks.push(Chunk::Block(database_link(
                    title,
                    &block.id.web_url(),
                    Escape::Text,
                )));
            }
            NotionBlockKind::Omitted(kind) => self.omit(kind),
        }
    }

    fn omit(&mut self, kind: &str) {
        *self.omitted.entry(kind.to_string()).or_default() += 1;
    }

    /// One list item and its nested children. Nested list items indent
    /// under it; nested paragraphs continue it on their own line; anything
    /// Lexical cannot nest in a list follows the list at the top level.
    fn list_item(&mut self, block: &NotionBlock, depth: usize, number: usize) {
        let indent = LIST_INDENT.repeat(depth);
        let (marker, text) = match &block.kind {
            NotionBlockKind::BulletedListItem(text) => ("-".to_string(), text),
            NotionBlockKind::NumberedListItem(text) => (format!("{}.", number.max(1)), text),
            NotionBlockKind::ToDo { text, checked } => {
                (if *checked { "- [x]" } else { "- [ ]" }.to_string(), text)
            }
            _ => unreachable!("list_item only renders list blocks"),
        };
        let body = self.inline(text, Escape::Text);
        let mut lines = body.split('\n');
        let first = lines.next().unwrap_or_default();
        self.chunks.push(Chunk::ListLine(
            format!("{indent}{marker} {first}").trim_end().to_string(),
        ));
        for line in lines {
            self.chunks
                .push(Chunk::ListLine(format!("{indent}{LIST_INDENT}{line}")));
        }

        let mut child_number = 0;
        for child in &block.children {
            child_number = match child.kind {
                NotionBlockKind::NumberedListItem(_) => child_number + 1,
                _ => 0,
            };
            match &child.kind {
                NotionBlockKind::BulletedListItem(_)
                | NotionBlockKind::NumberedListItem(_)
                | NotionBlockKind::ToDo { .. } => self.list_item(child, depth + 1, child_number),
                NotionBlockKind::Paragraph(text) if child.children.is_empty() => {
                    let text = self.inline(text, Escape::Text);
                    for line in text.split('\n').filter(|line| !line.trim().is_empty()) {
                        self.chunks
                            .push(Chunk::ListLine(format!("{indent}{LIST_INDENT}{line}")));
                    }
                }
                _ => self.block(child, 0),
            }
        }
    }

    /// A quote or callout: every line prefixed `> `, children inside it.
    fn quoted(
        &mut self,
        icon: Option<&str>,
        text: &[NotionRichText],
        children: &[NotionBlock],
    ) -> String {
        let mut lines: Vec<String> = Vec::new();
        let body = self.inline(text, Escape::Text);
        let mut first = true;
        for line in body.split('\n') {
            let line = match (first, icon) {
                (true, Some(icon)) if line.trim().is_empty() => icon.to_string(),
                (true, Some(icon)) => format!("{icon} {line}"),
                _ => line.to_string(),
            };
            first = false;
            lines.push(line);
        }
        if children.is_empty() {
            return prefix_quote(&lines);
        }
        // Lexical quotes hold inline content only: render the children on
        // their own and keep their text inside the quote, line by line.
        let mut nested = Renderer {
            ctx: self.ctx,
            chunks: Vec::new(),
            omitted: BTreeMap::new(),
            in_quote: true,
        };
        nested.blocks(children);
        for (kind, count) in nested.omitted {
            *self.omitted.entry(kind).or_default() += count;
        }
        let rendered = join_chunks(&nested.chunks);
        lines.extend(
            rendered
                .lines()
                .filter(|line| !line.trim().is_empty())
                .map(str::to_string),
        );
        prefix_quote(&lines)
    }

    fn table(&mut self, rows: &[NotionBlock], has_column_header: bool) -> Option<String> {
        let mut cells: Vec<Vec<String>> = rows
            .iter()
            .filter_map(|row| match &row.kind {
                NotionBlockKind::TableRow(cells) => Some(
                    cells
                        .iter()
                        .map(|cell| table_cell(&self.inline(cell, Escape::TableCell)))
                        .collect(),
                ),
                _ => None,
            })
            .collect();
        let width = cells
            .iter()
            .map(Vec::len)
            .max()
            .filter(|width| *width > 0)?;
        for row in &mut cells {
            row.resize(width, String::new());
        }
        let row_line = |row: &[String]| {
            format!(
                "| {} |",
                row.iter()
                    .map(|cell| if cell.is_empty() { " " } else { cell.as_str() })
                    .collect::<Vec<_>>()
                    .join(" | ")
            )
        };
        let divider = format!("| {} |", vec!["---"; width].join(" | "));
        let mut lines = Vec::with_capacity(cells.len() + 2);
        let mut rows = cells.iter();
        if has_column_header {
            lines.push(row_line(rows.next()?));
        } else {
            // A pipe table needs a header line; an empty one keeps every
            // Notion row a body row.
            lines.push(row_line(&vec![String::new(); width]));
        }
        lines.push(divider);
        lines.extend(rows.map(|row| row_line(row)));
        Some(lines.join("\n"))
    }

    fn image(&self, file: &NotionFile, alt: &str) -> String {
        let label = if alt.trim().is_empty() { "Image" } else { alt };
        match self.ctx.images.get(&file.url) {
            Some(hosted) if self.in_quote => link(label, &hosted.url, Escape::Text),
            Some(hosted) => image_tag(hosted, alt),
            // Re-hosting failed or the image was too large: a Notion-hosted
            // URL would expire within the hour, so link to the image's page.
            None if file.hosted => link(label, self.ctx.page_url, Escape::Text),
            None if self.in_quote => link(label, &file.url, Escape::Text),
            None => format!("![{}]({})", escape_label(alt), link_url(&file.url)),
        }
    }

    fn page_reference(&self, id: &NotionId, title: Option<&str>, escape: Escape) -> String {
        if let Some(document) = self.ctx.documents.get(id)
            && let Ok(mention) =
                mention_utils::serialize::document_mention(&document.id, &document.name)
        {
            return mention;
        }
        let title = title
            .map(str::trim)
            .filter(|title| !title.is_empty())
            .map(str::to_string)
            .or_else(|| self.ctx.titles.get(id).cloned())
            .unwrap_or_else(|| "Notion page".to_string());
        link(&title, &id.web_url(), escape)
    }

    /// Render rich text runs as inline Markdown. Line breaks stay `\n`;
    /// each caller decides how a break fits its block.
    fn inline(&self, runs: &[NotionRichText], escape: Escape) -> String {
        let mut out = String::new();
        for run in merge_runs(runs) {
            let rendered = match &run.kind {
                NotionRichTextKind::Equation(expression) => katex(expression.trim(), true),
                NotionRichTextKind::Mention(mention) => self.mention(mention, &run, escape),
                NotionRichTextKind::Text { link: target } => {
                    let text = if run.annotations.code {
                        code_span(&run.plain_text)
                    } else {
                        format_text(&escape_text(&run.plain_text, escape), run.annotations)
                    };
                    match target {
                        Some(url) if !run.plain_text.trim().is_empty() => {
                            link_with_formatted_label(&run.plain_text, &text, url, escape)
                        }
                        _ => text,
                    }
                }
            };
            out.push_str(&rendered);
        }
        out
    }

    fn mention(&self, mention: &NotionMention, run: &NotionRichText, escape: Escape) -> String {
        match mention {
            NotionMention::User { name } => {
                let name = name
                    .as_deref()
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .unwrap_or_else(|| run.plain_text.trim_start_matches('@').trim());
                format!("@{}", escape_text(name, escape))
            }
            NotionMention::Page(id) => {
                let title = Some(run.plain_text.trim())
                    .filter(|title| !title.is_empty() && *title != "Untitled")
                    .map(str::to_string);
                self.page_reference(id, title.as_deref(), escape)
            }
            NotionMention::Database(id) => {
                let title = Some(run.plain_text.trim())
                    .filter(|title| !title.is_empty())
                    .map(str::to_string)
                    .or_else(|| self.ctx.titles.get(id).cloned())
                    .unwrap_or_default();
                database_link(&title, &id.web_url(), escape)
            }
            NotionMention::Date { start, end } => {
                escape_text(&readable_date_range(start, end.as_deref()), escape)
            }
            NotionMention::LinkPreview(url) => {
                let label = Some(run.plain_text.trim())
                    .filter(|label| !label.is_empty())
                    .unwrap_or(url);
                link(label, url, escape)
            }
            NotionMention::Other => {
                format_text(&escape_text(&run.plain_text, escape), run.annotations)
            }
        }
    }
}

/// Where inline text lands, which decides what must be escaped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Escape {
    /// Ordinary block text.
    Text,
    /// A pipe-table cell: also no raw pipes or line breaks.
    TableCell,
    /// A link label (never at a line start; brackets are handled by the
    /// caller).
    Label,
}

/// Merge adjacent plain text runs with identical formatting and link, so
/// formatting delimiters wrap whole phrases (`**a b**`, not `**a** **b**`).
fn merge_runs(runs: &[NotionRichText]) -> Vec<NotionRichText> {
    let mut merged: Vec<NotionRichText> = Vec::new();
    for run in runs {
        if let Some(last) = merged.last_mut()
            && let (NotionRichTextKind::Text { link: a }, NotionRichTextKind::Text { link: b }) =
                (&last.kind, &run.kind)
            && a == b
            && last.annotations == run.annotations
        {
            last.plain_text.push_str(&run.plain_text);
            continue;
        }
        merged.push(run.clone());
    }
    merged
}

/// Escape characters Macro's Markdown import would read as syntax. Lexical
/// unescapes `\` + ASCII punctuation back to the literal character.
fn escape_text(text: &str, escape: Escape) -> String {
    let mut out = String::with_capacity(text.len());
    let mut at_line_start = escape != Escape::Label;
    let chars: Vec<char> = text.chars().collect();
    for (index, &c) in chars.iter().enumerate() {
        let next = chars.get(index + 1).copied();
        match c {
            '\\' | '*' | '_' | '`' | '~' | '[' | ']' | '<' | '>' | '$' => {
                out.push('\\');
                out.push(c);
            }
            // `==` highlights; `&name;` is an entity.
            '=' if next == Some('=') => out.push_str("\\="),
            '&' if next.is_some_and(|next| next == '#' || next.is_ascii_alphanumeric()) => {
                out.push_str("\\&");
            }
            '|' if escape == Escape::TableCell => out.push_str("&#124;"),
            '|' => out.push_str("\\|"),
            '\n' if escape == Escape::TableCell => out.push_str("\\n"),
            '#' | '-' | '+' if at_line_start => {
                out.push('\\');
                out.push(c);
            }
            '.' | ')' if at_line_start_digits(&out) && next.is_none_or(char::is_whitespace) => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
        at_line_start =
            escape != Escape::Label && (c == '\n' || (at_line_start && (c == ' ' || c == '\t')));
    }
    out
}

/// Whether `out` ends in a line that is only digits (an ordered-list marker
/// would follow).
fn at_line_start_digits(out: &str) -> bool {
    let line = out.rsplit('\n').next().unwrap_or(out).trim_start();
    !line.is_empty() && line.chars().all(|c| c.is_ascii_digit())
}

/// Wrap escaped text in its formatting delimiters, keeping surrounding
/// whitespace outside them (`** a**` would not parse as bold).
fn format_text(text: &str, annotations: NotionAnnotations) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return text.to_string();
    }
    let leading = &text[..text.len() - text.trim_start().len()];
    let trailing = &text[text.trim_end().len()..];
    let mut inner = trimmed.to_string();
    if annotations.underline {
        inner = format!("<u>{inner}</u>");
    }
    if annotations.strikethrough {
        inner = format!("~~{inner}~~");
    }
    if annotations.italic {
        inner = format!("*{inner}*");
    }
    if annotations.bold {
        inner = format!("**{inner}**");
    }
    format!("{leading}{inner}{trailing}")
}

fn link_with_formatted_label(plain: &str, formatted: &str, url: &str, escape: Escape) -> String {
    // A bracketed label cannot be a Markdown link label; outside tables the
    // native link node carries it verbatim.
    if escape == Escape::Text
        && (plain.contains('[') || plain.contains(']'))
        && let Ok(link) = mention_utils::serialize::ExternalLink::new(url, plain.trim())
        && let Ok(serialized) = link.serialize()
    {
        return serialized;
    }
    let leading = &formatted[..formatted.len() - formatted.trim_start().len()];
    let trailing = &formatted[formatted.trim_end().len()..];
    let label = formatted.trim().replace("\\[", "(").replace("\\]", ")");
    format!("{leading}[{label}]({}){trailing}", link_url(url))
}

/// A Markdown link with an escaped label. A label with brackets cannot be
/// a Markdown link label; outside tables Macro's native link node carries it
/// verbatim, inside tables the brackets become parentheses.
fn link(label: &str, url: &str, escape: Escape) -> String {
    let label = single_line(label);
    if label.contains('[') || label.contains(']') {
        if escape == Escape::Text
            && let Ok(link) = mention_utils::serialize::ExternalLink::new(url, &label)
            && let Ok(serialized) = link.serialize()
        {
            return serialized;
        }
        let label = label.replace('[', "(").replace(']', ")");
        return format!("[{}]({})", escape_label(&label), link_url(url));
    }
    format!("[{}]({})", escape_label(&label), link_url(url))
}

fn database_link(title: &str, url: &str, escape: Escape) -> String {
    let title = title.trim();
    let label = if title.is_empty() {
        "Notion database".to_string()
    } else {
        format!("{title} (Notion database)")
    };
    link(&label, url, escape)
}

fn escape_label(label: &str) -> String {
    escape_text(&single_line(label), Escape::Label)
}

/// Link targets cannot hold spaces or parentheses in Markdown.
fn link_url(url: &str) -> String {
    url.trim()
        .replace(' ', "%20")
        .replace('(', "%28")
        .replace(')', "%29")
}

fn code_span(code: &str) -> String {
    let longest_run = code.split(|c| c != '`').map(str::len).max().unwrap_or(0);
    let fence = "`".repeat(longest_run + 1);
    if longest_run > 0 {
        format!("{fence} {code} {fence}")
    } else {
        format!("{fence}{code}{fence}")
    }
}

fn fenced_code(code: &str, language: &str) -> String {
    let longest_run = code
        .lines()
        .map(|line| line.trim_start().chars().take_while(|c| *c == '`').count())
        .max()
        .unwrap_or(0);
    let fence = "`".repeat(longest_run.max(2) + 1);
    format!(
        "{fence}{language}\n{}\n{fence}",
        code.trim_end_matches('\n')
    )
}

/// Notion's code language names as Macro's code block accepts them
/// (`[\w-]+`). Plain text gets no language.
fn code_language(language: &str) -> String {
    let language = language.trim().to_ascii_lowercase();
    let mapped = match language.as_str() {
        "plain text" | "" => "",
        "c++" => "cpp",
        "c#" => "csharp",
        "f#" => "fsharp",
        "objective-c" => "objectivec",
        "vb.net" | "visual basic" => "vbnet",
        "shell" | "bash" => "bash",
        "markup" => "html",
        other => other,
    };
    mapped
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

/// Macro's KaTeX node, in the internal form its transformer accepts.
fn katex(expression: &str, inline: bool) -> String {
    let payload = serde_json::json!({ "equation": expression, "inline": inline })
        .to_string()
        .replace('<', "\\u003c")
        .replace('>', "\\u003e");
    format!("<m-katex-equation>{payload}</m-katex-equation>")
}

/// Macro's native image node for a re-hosted static file.
fn image_tag(image: &HostedImage, alt: &str) -> String {
    let payload = serde_json::json!({
        "url": image.url,
        "alt": alt,
        "srcType": "sfs",
        "id": image.id,
        "width": image.width,
        "height": image.height,
        "scale": 1,
    })
    .to_string()
    .replace('<', "\\u003c")
    .replace('>', "\\u003e");
    format!("<m-image>{payload}</m-image>")
}

fn table_cell(rendered: &str) -> String {
    rendered.trim().to_string()
}

fn prefix_quote(lines: &[String]) -> String {
    let lines: Vec<String> = lines
        .iter()
        .map(|line| {
            if line.trim().is_empty() {
                ">".to_string()
            } else {
                format!("> {line}")
            }
        })
        .collect();
    // Drop leading/trailing empty quote lines.
    let start = lines.iter().position(|line| line != ">");
    let end = lines.iter().rposition(|line| line != ">");
    match (start, end) {
        (Some(start), Some(end)) => lines[start..=end].join("\n"),
        _ => String::new(),
    }
}

fn single_line(text: &str) -> String {
    text.split('\n')
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

fn plain(runs: &[NotionRichText]) -> String {
    runs.iter().map(|run| run.plain_text.as_str()).collect()
}

fn attachment_noun(kind: &str) -> &'static str {
    match kind {
        "pdf" => "PDF",
        "video" => "Video",
        "audio" => "Audio",
        _ => "File",
    }
}

/// `2026-10-08` → `October 8, 2026`; date-times keep their time; ranges
/// join with an en dash.
pub(crate) fn readable_date_range(start: &str, end: Option<&str>) -> String {
    let start_label = readable_date(start);
    match end.filter(|end| !end.is_empty() && *end != start) {
        Some(end) => format!("{start_label} – {}", readable_date(end)),
        None => start_label,
    }
}

fn readable_date(value: &str) -> String {
    if let Ok(date) = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d") {
        return date.format("%B %-d, %Y").to_string();
    }
    if let Ok(time) = chrono::DateTime::parse_from_rfc3339(value) {
        return time.format("%B %-d, %Y %H:%M").to_string();
    }
    value.to_string()
}
