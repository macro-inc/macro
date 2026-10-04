//! `docx_corpus lines`: the text lines of every page with their positions,
//! as JSON, for comparing line and page breaks with a reference PDF.

use docx_engine::Document;
use docx_engine::layout::inline::Kind;
use docx_engine::layout::{Item, PlacedLine, StoryRef};
use pptx_engine::font::FontDb;
use serde::Serialize;
use std::path::PathBuf;

/// Options of `docx_corpus lines`.
#[derive(clap::Args)]
pub struct Args {
    /// Output JSON file (stdout when absent).
    #[arg(long)]
    out: Option<PathBuf>,
    /// Print the cluster positions of lines containing this text instead.
    #[arg(long)]
    chars: Option<String>,
    /// The document.
    file: PathBuf,
}

/// One placed line.
#[derive(Serialize)]
struct LineOut {
    /// Story: `body`, `part`, `footnote`, `endnote` or `textbox`.
    story: &'static str,
    /// Page x of the line's text start (points).
    x: f32,
    /// Page y of the line's top (points).
    y: f32,
    /// Page y of the baseline (points).
    baseline: f32,
    /// Line height (points).
    height: f32,
    /// Width of the content without trailing spaces (points).
    width: f32,
    /// Right edge of the line's text area (page x, points).
    right: f32,
    /// The text shown.
    text: String,
}

/// One page.
#[derive(Serialize)]
struct PageOut {
    width: f32,
    height: f32,
    lines: Vec<LineOut>,
    /// Drawings: (x, y, width, height).
    drawings: Vec<[f32; 4]>,
    /// The body area: (x, y, width, height).
    body: [f32; 4],
}

fn story_name(s: &StoryRef) -> &'static str {
    match s {
        StoryRef::Body => "body",
        StoryRef::Part(_) => "part",
        StoryRef::Footnote(_) => "footnote",
        StoryRef::Endnote(_) => "endnote",
        StoryRef::TextBox(..) => "textbox",
    }
}

fn line_text(l: &PlacedLine) -> String {
    let line = l.line();
    let clusters = &l.para.inline.clusters;
    let mut s = String::new();
    for c in &clusters[line.start..line.end.min(clusters.len())] {
        match c.kind {
            Kind::Text => s.push(c.ch),
            Kind::Space => s.push(' '),
            Kind::Tab => s.push('\t'),
            Kind::Object(_) => s.push('\u{FFFC}'),
            _ => {}
        }
    }
    s
}

fn print_clusters(page: usize, l: &PlacedLine) {
    let line = l.line();
    let pb = &l.para;
    println!(
        "page {} y {:.2} left {:.2} right {:.2} width {:.2} height {:.2} ends {:?}",
        page + 1,
        l.y,
        l.x + line.left,
        l.x + line.right,
        line.width,
        line.height,
        line.ends
    );
    let mut out = String::new();
    for k in line.start..line.end {
        let c = &pb.inline.clusters[k];
        let shown = match c.kind {
            Kind::Space => ' ',
            Kind::Tab => '→',
            Kind::Text => c.ch,
            _ => continue,
        };
        out.push_str(&format!(
            "{shown}@{:.2}+{:.3} ",
            l.x + pb.lines.x[k],
            pb.lines.adv[k]
        ));
    }
    println!("  {out}");
}

/// Runs the command.
pub fn run(args: &Args) -> Result<bool, Box<dyn std::error::Error>> {
    let fonts = FontDb::global();
    let doc = Document::open(std::fs::read(&args.file)?)?;
    let layout = doc.layout(fonts);
    if let Some(needle) = &args.chars {
        for (pi, page) in layout.pages.iter().enumerate() {
            for item in page.all_items() {
                if let Item::Line(l) = item
                    && line_text(l).contains(needle.as_str())
                {
                    print_clusters(pi, l);
                }
            }
        }
        return Ok(true);
    }
    let mut pages = Vec::with_capacity(layout.pages.len());
    for page in &layout.pages {
        let mut lines = Vec::new();
        let drawings = page
            .all_items()
            .filter_map(|i| match i {
                Item::Drawing(d) => Some([d.rect.x, d.rect.y, d.rect.w, d.rect.h]),
                _ => None,
            })
            .collect();
        for item in page.all_items() {
            if let Item::Line(l) = item {
                let line = l.line();
                lines.push(LineOut {
                    story: story_name(&l.para.story),
                    x: l.x + line.left,
                    y: l.y,
                    baseline: l.baseline(),
                    height: line.height,
                    width: line.width,
                    right: l.x + line.right,
                    text: line_text(l),
                });
            }
        }
        pages.push(PageOut {
            width: page.width,
            height: page.height,
            lines,
            drawings,
            body: [page.body.x, page.body.y, page.body.w, page.body.h],
        });
    }
    let json = serde_json::to_string(&pages)?;
    match &args.out {
        Some(p) => std::fs::write(p, json)?,
        None => println!("{json}"),
    }
    Ok(true)
}
