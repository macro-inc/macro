//! The report as text: one line, a job summary in Markdown, and a page.

use std::fmt::Write as _;

use super::{Cell, EntryRow, FunctionRow, Model, Status, Tally};

/// The page's frame: the styles, and where the body goes.
const PAGE: &str = include_str!("page.html");
/// Where the body goes in [`PAGE`].
const BODY_SLOT: &str = "<!-- body -->";
/// How many rows the job summary lists before it refers to the page.
const SUMMARY_ROWS: usize = 60;

/// The one line a run prints.
pub(crate) fn headline(model: &Model) -> String {
    let backend = model.functions_listed - model.functions_ui_only - model.functions_outside;
    format!(
        "{backend} backend functions: Gmail {} covered, {} performed only, {} open; \
         Outlook {} covered, {} performed only, {} open ({} scenarios recorded)",
        model.functions_gmail.covered,
        model.functions_gmail.performed,
        model.functions_gmail.open,
        model.functions_outlook.covered,
        model.functions_outlook.performed,
        model.functions_outlook.open,
        model.suite.recorded,
    )
}

fn tally_cells(tally: &Tally) -> String {
    format!(
        "{} | {} | {} | {} | {}",
        tally.total, tally.covered, tally.performed, tally.waived, tally.open
    )
}

fn status_word(cell: Option<&Cell>) -> &'static str {
    match cell.map(|cell| cell.status) {
        None => "n/a",
        Some(Status::Covered) => "covered",
        Some(Status::Performed) => "performed",
        Some(Status::Waived) => "waived",
        Some(Status::Open) => "open",
    }
}

fn is_gap(cell: Option<&Cell>) -> bool {
    cell.is_some_and(|cell| matches!(cell.status, Status::Open | Status::Performed))
}

fn open_functions(model: &Model) -> Vec<&FunctionRow> {
    model
        .functions
        .iter()
        .filter(|row| is_gap(row.gmail.as_ref()) || is_gap(row.outlook.as_ref()))
        .collect()
}

fn open_entries(model: &Model) -> Vec<&EntryRow> {
    model
        .entry_rows
        .iter()
        .filter(|row| is_gap(row.gmail.as_ref()) || is_gap(row.outlook.as_ref()))
        .collect()
}

/// The job summary.
pub(crate) fn markdown(model: &Model) -> String {
    let mut out = String::new();
    let backend = model.functions_listed - model.functions_ui_only - model.functions_outside;
    let _ = writeln!(out, "## Email backend coverage\n");
    let _ = writeln!(
        out,
        "{} functions of email are listed; the email backend has a part in {backend} \
         ({} more are carried out by other services and not measured here). A function \
         is **covered** when a passing scenario performed it on that provider and is recorded \
         as checking its result, **performed** when scenarios did it and none is recorded as \
         checking it.\n",
        model.functions_listed, model.functions_outside
    );
    let _ = writeln!(
        out,
        "| Functions | total | covered | performed only | waived | open |"
    );
    let _ = writeln!(out, "| --- | ---: | ---: | ---: | ---: | ---: |");
    let _ = writeln!(out, "| Gmail | {} |", tally_cells(&model.functions_gmail));
    let _ = writeln!(
        out,
        "| Outlook | {} |\n",
        tally_cells(&model.functions_outlook)
    );

    let _ = writeln!(out, "### Entry points reached\n");
    let _ = writeln!(
        out,
        "| Kind | Gmail total | reached | waived | open | Outlook total | reached | waived | open |"
    );
    let _ = writeln!(
        out,
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    );
    for kind in &model.entry_points {
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} | {} | {} | {} | {} | {} |",
            kind.kind,
            kind.gmail.total,
            kind.gmail.covered,
            kind.gmail.waived,
            kind.gmail.open,
            kind.outlook.total,
            kind.outlook.covered,
            kind.outlook.waived,
            kind.outlook.open,
        );
    }
    let _ = writeln!(out);

    let _ = writeln!(out, "### Scenarios\n");
    let _ = writeln!(
        out,
        "| Run | scenarios | failed | needed a retry | seconds |"
    );
    let _ = writeln!(out, "| --- | ---: | ---: | ---: | ---: |");
    for run in &model.suite.runs {
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} | {:.0} |",
            run.name, run.tests, run.failed, run.flaky, run.seconds
        );
    }
    let _ = writeln!(
        out,
        "\n{} scenarios left a record that counts.\n",
        model.suite.recorded
    );
    list(&mut out, "Needed a retry", &model.suite.flaky);
    list(&mut out, "Failed", &model.suite.failed);
    list(
        &mut out,
        "The ledger is broken (this fails the job)",
        &model.broken,
    );
    list(
        &mut out,
        "Checks and waivers the records do not bear out",
        &model.stale,
    );

    let functions = open_functions(model);
    let _ = writeln!(
        out,
        "<details><summary>{} functions not covered on a provider</summary>\n",
        functions.len()
    );
    let _ = writeln!(out, "| Function | | Gmail | Outlook |");
    let _ = writeln!(out, "| --- | --- | --- | --- |");
    for row in functions.iter().take(SUMMARY_ROWS) {
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} |",
            row.id,
            row.function,
            status_word(row.gmail.as_ref()),
            status_word(row.outlook.as_ref())
        );
    }
    if functions.len() > SUMMARY_ROWS {
        let _ = writeln!(out, "\nThe rest are in the report artifact.");
    }
    let _ = writeln!(out, "\n</details>\n");

    let entries = open_entries(model);
    let _ = writeln!(
        out,
        "<details><summary>{} entry points no scenario reaches on a provider</summary>\n",
        entries.len()
    );
    let _ = writeln!(out, "| Entry point | Gmail | Outlook |");
    let _ = writeln!(out, "| --- | --- | --- |");
    for row in entries.iter().take(SUMMARY_ROWS) {
        let _ = writeln!(
            out,
            "| `{} {}` | {} | {} |",
            row.kind,
            row.key,
            status_word(row.gmail.as_ref()),
            status_word(row.outlook.as_ref())
        );
    }
    if entries.len() > SUMMARY_ROWS {
        let _ = writeln!(out, "\nThe rest are in the report artifact.");
    }
    let _ = writeln!(out, "\n</details>");
    out
}

fn list(out: &mut String, title: &str, items: &[String]) {
    if items.is_empty() {
        return;
    }
    let _ = writeln!(out, "**{title}**\n");
    for item in items {
        let _ = writeln!(out, "- {item}");
    }
    let _ = writeln!(out);
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn html_cell(cell: Option<&Cell>) -> String {
    let word = status_word(cell);
    let Some(cell) = cell else {
        return format!("<td class=\"na\">{word}</td>");
    };
    let mut detail = String::new();
    if cell.scenarios > 0 {
        let _ = write!(
            detail,
            "<details><summary>{} scenario{}</summary>{}</details>",
            cell.scenarios,
            if cell.scenarios == 1 { "" } else { "s" },
            cell.examples
                .iter()
                .map(|name| format!("<code>{}</code>", escape(name)))
                .collect::<Vec<_>>()
                .join("<br>")
        );
    }
    if let Some(reason) = &cell.reason {
        let _ = write!(detail, "<small>{}</small>", escape(reason));
    }
    format!("<td class=\"{word}\"><b>{word}</b>{detail}</td>")
}

fn html_tally(name: &str, tally: &Tally) -> String {
    format!(
        "<tr><th>{name}</th><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
        tally.total, tally.covered, tally.performed, tally.waived, tally.open
    )
}

fn html_list(out: &mut String, title: &str, items: &[String]) {
    if items.is_empty() {
        return;
    }
    let _ = write!(out, "<h3>{title} ({})</h3><ul>", items.len());
    for item in items {
        let _ = write!(out, "<li>{}</li>", escape(item));
    }
    let _ = write!(out, "</ul>");
}

/// The page.
pub(crate) fn html(model: &Model) -> String {
    let mut out = String::new();
    let backend = model.functions_listed - model.functions_ui_only - model.functions_outside;
    let _ = write!(
        out,
        "<h1>Email backend coverage</h1><p>{} functions of email are listed; the email backend has \
         a part in {backend} ({} more are carried out by other services and not measured \
         here). A function is <b>covered</b> on a provider when a passing scenario \
         performed it there and is recorded as checking its result; <b>performed</b> when \
         scenarios did it and none is recorded as checking it. {} scenarios left a record.</p>",
        model.functions_listed, model.functions_outside, model.suite.recorded
    );
    let _ = write!(
        out,
        "<h2>Functions</h2><div class=\"scroll\"><table><tr><th></th><th>total</th>\
         <th>covered</th><th>performed only</th><th>waived</th><th>open</th></tr>{}{}</table></div>",
        html_tally("Gmail", &model.functions_gmail),
        html_tally("Outlook", &model.functions_outlook)
    );

    let _ = write!(
        out,
        "<h2>Entry points reached</h2><div class=\"scroll\"><table><tr><th>kind</th>\
         <th>Gmail total</th><th>reached</th><th>waived</th><th>open</th>\
         <th>Outlook total</th><th>reached</th><th>waived</th><th>open</th></tr>"
    );
    for kind in &model.entry_points {
        let _ = write!(
            out,
            "<tr><th>{}</th><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td>\
             <td>{}</td><td>{}</td></tr>",
            kind.kind,
            kind.gmail.total,
            kind.gmail.covered,
            kind.gmail.waived,
            kind.gmail.open,
            kind.outlook.total,
            kind.outlook.covered,
            kind.outlook.waived,
            kind.outlook.open,
        );
    }
    let _ = write!(out, "</table></div>");

    let _ = write!(
        out,
        "<h2>Scenarios</h2><div class=\"scroll\"><table><tr><th>run</th><th>scenarios</th>\
         <th>failed</th><th>needed a retry</th><th>seconds</th></tr>"
    );
    for run in &model.suite.runs {
        let _ = write!(
            out,
            "<tr><th>{}</th><td>{}</td><td>{}</td><td>{}</td><td>{:.0}</td></tr>",
            escape(&run.name),
            run.tests,
            run.failed,
            run.flaky,
            run.seconds
        );
    }
    let _ = write!(out, "</table></div>");
    html_list(&mut out, "Failed", &model.suite.failed);
    html_list(&mut out, "Needed a retry", &model.suite.flaky);
    html_list(&mut out, "The ledger is broken", &model.broken);
    html_list(
        &mut out,
        "Checks and waivers the records do not bear out",
        &model.stale,
    );

    let _ = write!(out, "<h2>Every function</h2>");
    let mut area = "";
    for row in &model.functions {
        if row.area != area {
            if !area.is_empty() {
                let _ = write!(out, "</table></div>");
            }
            area = &row.area;
            let _ = write!(
                out,
                "<h3>{}</h3><div class=\"scroll\"><table class=\"rows\"><tr><th>function</th>\
                 <th>Gmail</th><th>Outlook</th></tr>",
                escape(area)
            );
        }
        let _ = write!(
            out,
            "<tr><td><small>{}</small> {}</td>",
            escape(&row.id),
            escape(&row.function)
        );
        let elsewhere = row
            .ui_only
            .as_ref()
            .map(|reason| ("no backend part", reason))
            .or_else(|| {
                row.outside
                    .as_ref()
                    .map(|service| ("another service", service))
            });
        match elsewhere {
            Some((label, reason)) => {
                let _ = write!(
                    out,
                    "<td class=\"na\" colspan=\"2\">{label}: {}</td></tr>",
                    escape(reason)
                );
            }
            None => {
                let _ = write!(
                    out,
                    "{}{}</tr>",
                    html_cell(row.gmail.as_ref()),
                    html_cell(row.outlook.as_ref())
                );
            }
        }
    }
    if !area.is_empty() {
        let _ = write!(out, "</table></div>");
    }

    let _ = write!(out, "<h2>Every entry point</h2>");
    let mut kind = "";
    for row in &model.entry_rows {
        if row.kind != kind {
            if !kind.is_empty() {
                let _ = write!(out, "</table></div></details>");
            }
            kind = &row.kind;
            let _ = write!(
                out,
                "<details class=\"kind\"><summary>{}</summary><div class=\"scroll\">\
                 <table class=\"rows\"><tr><th>entry point</th><th>functions</th><th>Gmail</th>\
                 <th>Outlook</th></tr>",
                escape(kind)
            );
        }
        let _ = write!(
            out,
            "<tr><td><code>{}</code><br><small>{}</small></td><td>{}</td>{}{}</tr>",
            escape(&row.key),
            escape(&row.source),
            escape(&row.functions.join(" ")),
            html_cell(row.gmail.as_ref()),
            html_cell(row.outlook.as_ref())
        );
    }
    if !kind.is_empty() {
        let _ = write!(out, "</table></div></details>");
    }

    html_list(
        &mut out,
        "Background loops (listed, not counted)",
        &model.loops,
    );
    html_list(
        &mut out,
        "Requests scenarios made that are in no list",
        &model.unlisted,
    );
    html_list(
        &mut out,
        "Scenarios that linked no inbox (they count for both providers)",
        &model.suite.no_inbox,
    );
    html_list(
        &mut out,
        "Scenarios with inboxes of both providers (they count for both)",
        &model.suite.both_providers,
    );
    html_list(
        &mut out,
        "Scenarios that passed and left no record",
        &model.suite.unrecorded,
    );
    PAGE.replace(BODY_SLOT, &out)
}
