//! The HTML fidelity report: every scored slide with our render, the
//! reference, and a diff, worst first.

use pptx_engine::fidelity::Score;
use std::fmt::Write as _;
use std::path::Path;

/// One slide in the report.
pub struct SlideRow {
    /// Corpus path of the deck.
    pub deck: String,
    /// Output directory name of the deck.
    pub stem: String,
    /// 1-based slide number.
    pub slide: usize,
    /// Score against the reference.
    pub score: Option<Score>,
    /// Baseline SSIM.
    pub baseline_ssim: Option<f32>,
    /// Known-divergence note.
    pub note: Option<String>,
    /// Render time.
    pub millis: u128,
    /// The render fingerprint moved.
    pub fingerprint_changed: bool,
    /// Rendering error.
    pub error: Option<String>,
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Writes `out/report.html`.
pub fn write(out: &Path, rows: &[SlideRow]) -> std::io::Result<()> {
    let mut sorted: Vec<&SlideRow> = rows
        .iter()
        .filter(|r| r.score.is_some() || r.error.is_some())
        .collect();
    sorted.sort_by(|a, b| {
        let key = |r: &SlideRow| r.score.map_or(-1.0, |s| s.ssim);
        key(a).total_cmp(&key(b))
    });
    let scored: Vec<f32> = rows
        .iter()
        .filter_map(|r| r.score.map(|s| s.ssim))
        .collect();
    let mean = if scored.is_empty() {
        0.0
    } else {
        scored.iter().sum::<f32>() / scored.len() as f32
    };
    let below = |t: f32| scored.iter().filter(|s| **s < t).count();
    let mut html = String::new();
    let _ = write!(
        html,
        "<!doctype html><meta charset=utf-8><title>pptx_engine fidelity</title><style>\
body{{font:14px system-ui,sans-serif;margin:24px;background:#fafafa;color:#222}}\
table{{border-collapse:collapse}}td,th{{padding:6px;border-bottom:1px solid #ddd;vertical-align:top;text-align:left}}\
img{{width:320px;border:1px solid #ccc;background:#fff}}.bad{{color:#b00020;font-weight:600}}.note{{color:#555;max-width:260px}}\
</style><h1>pptx_engine vs LibreOffice</h1><p>{} slides scored · mean SSIM {:.4} · {} below 0.95 · {} below 0.90</p>\
<table><tr><th>Slide</th><th>Score</th><th>pptx_engine</th><th>LibreOffice</th><th>Diff</th></tr>",
        scored.len(),
        mean,
        below(0.95),
        below(0.90)
    );
    for r in sorted {
        let n = r.slide;
        let score = match r.score {
            Some(s) => {
                let base = r
                    .baseline_ssim
                    .map(|b| format!("<br>baseline {b:.4}"))
                    .unwrap_or_default();
                let class = if r.baseline_ssim.is_some_and(|b| s.ssim < b - 0.005) {
                    " class=bad"
                } else {
                    ""
                };
                format!(
                    "<span{class}>SSIM {:.4}</span><br>mismatch {:.2}%{base}<br>{} ms",
                    s.ssim,
                    s.mismatch * 100.0,
                    r.millis
                )
            }
            None => String::new(),
        };
        let note = r
            .note
            .as_deref()
            .map(|n| format!("<div class=note>{}</div>", esc(n)))
            .unwrap_or_default();
        let error = r
            .error
            .as_deref()
            .map(|e| format!("<div class=bad>{}</div>", esc(e)))
            .unwrap_or_default();
        let changed = if r.fingerprint_changed {
            "<div class=bad>render changed</div>"
        } else {
            ""
        };
        let _ = write!(
            html,
            "<tr><td>{}<br>slide {n}{note}{error}{changed}</td><td>{score}</td>\
<td><img loading=lazy src=\"{s}/ours-{n:03}.png\"></td><td><img loading=lazy src=\"{s}/ref-{n:03}.png\"></td>\
<td><img loading=lazy src=\"{s}/diff-{n:03}.png\"></td></tr>",
            esc(&r.deck),
            s = esc(&r.stem),
        );
    }
    html.push_str("</table>");
    std::fs::create_dir_all(out)?;
    std::fs::write(out.join("report.html"), html)?;
    let json: Vec<serde_json::Value> = rows
        .iter()
        .map(|r| {
            serde_json::json!({
                "deck": r.deck, "slide": r.slide, "ssim": r.score.map(|s| s.ssim),
                "mismatch": r.score.map(|s| s.mismatch), "ms": r.millis, "error": r.error,
            })
        })
        .collect();
    std::fs::write(
        out.join("scores.json"),
        serde_json::to_vec_pretty(&json).map_err(std::io::Error::other)?,
    )
}
