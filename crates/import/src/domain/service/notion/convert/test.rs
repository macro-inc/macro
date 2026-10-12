use super::*;
use crate::domain::models::NotionAnnotations;
use crate::domain::service::notion::test::{block, nid, plain};

const PAGE_URL: &str = "https://www.notion.so/example/Plan-0123";

fn ctx() -> ConvertContext<'static> {
    ConvertContext {
        page_url: PAGE_URL,
        ..ConvertContext::default()
    }
}

fn md(blocks: &[NotionBlock]) -> String {
    convert(blocks, false, &ctx()).markdown
}

fn run(text: &str, annotations: NotionAnnotations) -> NotionRichText {
    NotionRichText {
        kind: NotionRichTextKind::Text { link: None },
        plain_text: text.into(),
        annotations,
    }
}

fn with_children(mut parent: NotionBlock, children: Vec<NotionBlock>) -> NotionBlock {
    parent.has_children = true;
    parent.children = children;
    parent
}

#[test]
fn rich_text_keeps_formatting_and_drops_colors() {
    let bold = NotionAnnotations {
        bold: true,
        ..NotionAnnotations::default()
    };
    let text = vec![
        run("Plain, ", NotionAnnotations::default()),
        run("bold ", bold),
        run("bolder", bold),
        run(" then ", NotionAnnotations::default()),
        run(
            "everything",
            NotionAnnotations {
                bold: true,
                italic: true,
                strikethrough: true,
                underline: true,
                code: false,
            },
        ),
        run(" and ", NotionAnnotations::default()),
        run(
            "a `tick`",
            NotionAnnotations {
                code: true,
                ..NotionAnnotations::default()
            },
        ),
    ];
    assert_eq!(
        md(&[block(1, NotionBlockKind::Paragraph(text))]),
        "Plain, **bold bolder** then ***~~<u>everything</u>~~*** and `` a `tick` ``"
    );
}

#[test]
fn literal_markdown_characters_are_escaped() {
    assert_eq!(
        md(&[block(
            1,
            NotionBlockKind::Paragraph(plain(
                "# not a heading\n- not a list\n1. not ordered\n2*3 = 6, a_b, [x], <y>, $5, a | b, ==hi=="
            ))
        )]),
        "\\# not a heading\n\\- not a list\n1\\. not ordered\n2\\*3 = 6, a\\_b, \\[x\\], \\<y\\>, \\$5, a \\| b, \\==hi\\=="
    );
}

#[test]
fn links_mentions_dates_and_inline_equations() {
    let text = vec![
        NotionRichText {
            kind: NotionRichTextKind::Text {
                link: Some("https://example.com/a b".into()),
            },
            plain_text: "the brief".into(),
            annotations: NotionAnnotations::default(),
        },
        run(" by ", NotionAnnotations::default()),
        NotionRichText {
            kind: NotionRichTextKind::Mention(NotionMention::User {
                name: Some("Dana Example".into()),
            }),
            plain_text: "@Dana Example".into(),
            annotations: NotionAnnotations::default(),
        },
        run(" on ", NotionAnnotations::default()),
        NotionRichText {
            kind: NotionRichTextKind::Mention(NotionMention::Date {
                start: "2026-10-08".into(),
                end: Some("2026-10-10".into()),
            }),
            plain_text: "2026-10-08 → 2026-10-10".into(),
            annotations: NotionAnnotations::default(),
        },
        run(": ", NotionAnnotations::default()),
        NotionRichText {
            kind: NotionRichTextKind::Equation("a<b".into()),
            plain_text: "a<b".into(),
            annotations: NotionAnnotations::default(),
        },
        run(" see ", NotionAnnotations::default()),
        NotionRichText {
            kind: NotionRichTextKind::Text {
                link: Some("https://example.com/x".into()),
            },
            plain_text: "[draft] notes".into(),
            annotations: NotionAnnotations::default(),
        },
    ];
    assert_eq!(
        md(&[block(1, NotionBlockKind::Paragraph(text))]),
        "[the brief](https://example.com/a%20b) by @Dana Example on October 8, 2026 – October 10, 2026: \
         <m-katex-equation>{\"equation\":\"a\\u003cb\",\"inline\":true}</m-katex-equation> see \
         <m-link>{\"url\":\"https://example.com/x\",\"text\":\"[draft] notes\",\"title\":\"\"}</m-link>"
    );
}

#[test]
fn headings_lists_and_todos() {
    let blocks = vec![
        block(
            1,
            NotionBlockKind::Heading {
                level: 1,
                text: plain("Goals"),
                toggleable: false,
            },
        ),
        with_children(
            block(2, NotionBlockKind::BulletedListItem(plain("Ship it"))),
            vec![
                with_children(
                    block(3, NotionBlockKind::BulletedListItem(plain("Exports"))),
                    vec![block(
                        4,
                        NotionBlockKind::NumberedListItem(plain("Backfill")),
                    )],
                ),
                block(5, NotionBlockKind::Paragraph(plain("Owner: platform"))),
            ],
        ),
        block(6, NotionBlockKind::BulletedListItem(plain("Uptime"))),
        block(7, NotionBlockKind::NumberedListItem(plain("Design"))),
        block(8, NotionBlockKind::NumberedListItem(plain("Beta"))),
        block(9, NotionBlockKind::Paragraph(plain("Then:"))),
        block(10, NotionBlockKind::NumberedListItem(plain("GA"))),
        block(
            11,
            NotionBlockKind::ToDo {
                text: plain("Draft"),
                checked: true,
            },
        ),
        block(
            12,
            NotionBlockKind::ToDo {
                text: plain("Review"),
                checked: false,
            },
        ),
        block(
            13,
            NotionBlockKind::Heading {
                level: 3,
                text: plain("Line\nbreak"),
                toggleable: false,
            },
        ),
    ];
    assert_eq!(
        md(&blocks),
        "# Goals\n\n\
         - Ship it\n  - Exports\n    1. Backfill\n  Owner: platform\n- Uptime\n1. Design\n2. Beta\n\n\
         Then:\n\n\
         1. GA\n- [x] Draft\n- [ ] Review\n\n\
         ### Line break"
    );
}

#[test]
fn list_children_lexical_cannot_nest_follow_the_list() {
    let blocks = vec![with_children(
        block(1, NotionBlockKind::BulletedListItem(plain("Steps"))),
        vec![block(
            2,
            NotionBlockKind::Code {
                text: plain("make"),
                language: "shell".into(),
            },
        )],
    )];
    assert_eq!(md(&blocks), "- Steps\n\n```bash\nmake\n```");
}

#[test]
fn quotes_and_callouts_keep_children_inside() {
    let image = NotionBlockKind::Image {
        file: NotionFile {
            url: "https://images.example.com/a.png".into(),
            hosted: false,
            name: None,
        },
        caption: plain("Chart"),
    };
    let blocks = vec![
        with_children(
            block(1, NotionBlockKind::Quote(plain("Ship small.\nShip often."))),
            vec![block(2, NotionBlockKind::Paragraph(plain("— the team")))],
        ),
        with_children(
            block(
                3,
                NotionBlockKind::Callout {
                    text: plain("Freeze Nov 1"),
                    icon_emoji: Some("⚠️".into()),
                },
            ),
            vec![
                block(4, NotionBlockKind::BulletedListItem(plain("No migrations"))),
                block(5, image),
                block(
                    6,
                    NotionBlockKind::Code {
                        text: plain("deploy --freeze"),
                        language: "bash".into(),
                    },
                ),
            ],
        ),
    ];
    assert_eq!(
        md(&blocks),
        "> Ship small.\n> Ship often.\n> — the team\n\n\
         > ⚠️ Freeze Nov 1\n> - No migrations\n> [Chart](https://images.example.com/a.png)\n> `deploy --freeze`"
    );
}

#[test]
fn code_dividers_and_block_equations() {
    let blocks = vec![
        block(
            1,
            NotionBlockKind::Code {
                text: plain("fn main() {}\n"),
                language: "Rust".into(),
            },
        ),
        block(
            2,
            NotionBlockKind::Code {
                text: plain("```\nnested\n```"),
                language: "C++".into(),
            },
        ),
        block(
            3,
            NotionBlockKind::Code {
                text: plain("plain"),
                language: "plain text".into(),
            },
        ),
        block(4, NotionBlockKind::Divider),
        block(5, NotionBlockKind::Equation("\\sum x_i".into())),
    ];
    assert_eq!(
        md(&blocks),
        "```rust\nfn main() {}\n```\n\n````cpp\n```\nnested\n```\n````\n\n```\nplain\n```\n\n---\n\n\
         <m-katex-equation>{\"equation\":\"\\\\sum x_i\",\"inline\":false}</m-katex-equation>"
    );
}

#[test]
fn tables_are_rectangular_pipe_tables() {
    let row = |n: u32, cells: &[&str]| {
        block(
            n,
            NotionBlockKind::TableRow(cells.iter().map(|cell| plain(cell)).collect()),
        )
    };
    let header = with_children(
        block(
            1,
            NotionBlockKind::Table {
                has_column_header: true,
                width: 3,
            },
        ),
        vec![
            row(2, &["Area", "Owner", "Status"]),
            row(3, &["Billing", "Sam", "A | B\nnext"]),
            row(4, &["Exports"]),
        ],
    );
    assert_eq!(
        md(&[header]),
        "| Area | Owner | Status |\n| --- | --- | --- |\n| Billing | Sam | A &#124; B\\nnext |\n| Exports |   |   |"
    );
    let headless = with_children(
        block(
            5,
            NotionBlockKind::Table {
                has_column_header: false,
                width: 2,
            },
        ),
        vec![row(6, &["a", "b"])],
    );
    assert_eq!(md(&[headless]), "|   |   |\n| --- | --- |\n| a | b |");
}

#[test]
fn page_links_become_mentions_only_for_imported_pages() {
    let mut context = ctx();
    context.documents.insert(
        nid(2),
        LinkedDocument {
            id: "doc-2".into(),
            name: "🚀 Spec".into(),
        },
    );
    context.titles.insert(nid(5), "Projects".into());
    let blocks = vec![
        block(
            2,
            NotionBlockKind::ChildPage {
                title: "Spec".into(),
            },
        ),
        block(
            3,
            NotionBlockKind::ChildPage {
                title: "Notes".into(),
            },
        ),
        block(4, NotionBlockKind::LinkToPage(nid(9))),
        block(5, NotionBlockKind::LinkToDatabase(nid(5))),
        block(
            6,
            NotionBlockKind::ChildDatabase {
                title: "Tasks".into(),
            },
        ),
    ];
    assert_eq!(
        convert(&blocks, false, &context).markdown,
        format!(
            "<m-document-mention>{{\"documentId\":\"doc-2\",\"blockName\":\"md\",\"documentName\":\"🚀 Spec\",\"blockParams\":{{}},\"collapsed\":false}}</m-document-mention>\n\n\
             [Notes](https://www.notion.so/{})\n\n\
             [Notion page](https://www.notion.so/{})\n\n\
             [Projects (Notion database)](https://www.notion.so/{})\n\n\
             [Tasks (Notion database)](https://www.notion.so/{})",
            nid(3),
            nid(9),
            nid(5),
            nid(6)
        )
    );
}

#[test]
fn unsupported_blocks_are_omitted_and_counted() {
    let blocks = vec![
        block(1, NotionBlockKind::Omitted("table_of_contents".into())),
        block(2, NotionBlockKind::Omitted("breadcrumb".into())),
        block(3, NotionBlockKind::Omitted("unsupported".into())),
        block(4, NotionBlockKind::Omitted("unsupported".into())),
        block(5, NotionBlockKind::Paragraph(Vec::new())),
    ];
    let converted = convert(&blocks, false, &ctx());
    assert!(converted.is_empty());
    assert_eq!(
        converted.omitted,
        BTreeMap::from([
            ("breadcrumb".to_string(), 1),
            ("table_of_contents".to_string(), 1),
            ("unsupported".to_string(), 2),
        ])
    );
}

#[test]
fn truncated_pages_link_to_the_rest() {
    let blocks = vec![block(1, NotionBlockKind::Paragraph(plain("Start")))];
    assert_eq!(
        convert(&blocks, true, &ctx()).markdown,
        format!("Start\n\n[Continue reading in Notion]({PAGE_URL})")
    );
}
