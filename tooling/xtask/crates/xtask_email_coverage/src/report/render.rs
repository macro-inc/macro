//! The report as text: one line, a job summary in Markdown, and a page.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use super::{Cell, EntryRow, FunctionRow, Model, OwnedRow, Status, Tally};

/// The page's frame: the styles, and where the body goes.
const PAGE: &str = include_str!("page.html");
/// Where the body goes in [`PAGE`].
const BODY_SLOT: &str = "<!-- body -->";
/// How many rows the job summary lists before it refers to the page.
const SUMMARY_ROWS: usize = 60;
/// What is said of a function another service carries out.
const DEFERRED: &str = "deferred to the full-stack tier";

/// The functions the email backend has a part in and this tier measures.
fn backend(model: &Model) -> usize {
    model.functions_listed - model.functions_ui_only - model.functions_deferred
}

/// The one line a run prints.
pub(crate) fn headline(model: &Model) -> String {
    let of = |tally: &Tally| {
        format!(
            "{} proved, {} claimed, {} performed only, {} open",
            tally.proved, tally.claimed, tally.performed, tally.open
        )
    };
    format!(
        "{} backend functions: Gmail {}; Outlook {}; {} {DEFERRED} ({} scenarios recorded)",
        backend(model),
        of(&model.functions_gmail),
        of(&model.functions_outlook),
        model.functions_deferred,
        model.suite.recorded,
    )
}

/// What the statuses of a function mean.
fn legend(bold: fn(&str) -> String) -> String {
    format!(
        "A function is {} on a provider when a passing scenario performed it there, is \
         recorded as checking its result, and a deliberate break in product code made that \
         scenario fail: only that counts as covered. It is {} when the scenario is recorded \
         as checking it and no break has shown it, {} when scenarios did it and none is \
         recorded as checking it.",
        bold("proved"),
        bold("claimed"),
        bold("performed")
    )
}

fn tally_cells(tally: &Tally) -> String {
    format!(
        "{} | {} | {} | {} | {} | {}",
        tally.total, tally.proved, tally.claimed, tally.performed, tally.waived, tally.open
    )
}

fn status_word(cell: Option<&Cell>) -> &'static str {
    match cell.map(|cell| cell.status) {
        None => "n/a",
        Some(Status::Proved) => "proved",
        Some(Status::Claimed) => "claimed",
        Some(Status::Covered) => "covered",
        Some(Status::Performed) => "performed",
        Some(Status::Waived) => "waived",
        Some(Status::Deferred) => "deferred",
        Some(Status::Owned) => "owned",
        Some(Status::Open) => "open",
    }
}

fn is_gap(cell: Option<&Cell>) -> bool {
    cell.is_some_and(|cell| {
        matches!(
            cell.status,
            Status::Open | Status::Performed | Status::Claimed
        )
    })
}

/// The functions this tier measures or defers: all but the browser's own.
fn backend_functions(model: &Model) -> Vec<&FunctionRow> {
    model
        .functions
        .iter()
        .filter(|row| row.ui_only.is_none())
        .collect()
}

/// A function's standing on a provider in the job summary, naming the bug
/// that keeps it open.
fn summary_cell(row: &FunctionRow, cell: Option<&Cell>) -> String {
    if row.deferred.is_some() {
        return "deferred".to_owned();
    }
    match &row.bug {
        Some(bug) if cell.is_some() => format!("open (known bug {bug})"),
        _ => status_word(cell).to_owned(),
    }
}

fn open_entries(model: &Model) -> Vec<&EntryRow> {
    model
        .entry_rows
        .iter()
        .filter(|row| is_gap(row.gmail.as_ref()) || is_gap(row.outlook.as_ref()))
        .collect()
}

/// The owners of the entry points counted elsewhere, each with its rows.
fn owned_by_owner(model: &Model) -> BTreeMap<&str, Vec<&OwnedRow>> {
    let mut owners: BTreeMap<&str, Vec<&OwnedRow>> = BTreeMap::new();
    for row in &model.owned {
        owners.entry(&row.owner).or_default().push(row);
    }
    owners
}

/// What is said of the entry points `owner`'s functions own.
fn owned_note(owner: &str) -> String {
    format!(
        "Entry points the {owner} functions call, not email's: counted there, and in none of \
         the totals above."
    )
}

/// Whether a scenario reached an owned entry point on a provider.
fn reached_word(reached: Option<bool>) -> &'static str {
    match reached {
        None => "n/a",
        Some(true) => "reached",
        Some(false) => "not reached",
    }
}

/// The job summary.
pub(crate) fn markdown(model: &Model) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "## Email backend coverage\n");
    let _ = writeln!(out, "{}\n", headline(model));
    let _ = writeln!(
        out,
        "{} functions of email are listed; the email backend has a part in {} ({} more are \
         carried out by other services and {DEFERRED}). {}\n",
        model.functions_listed,
        backend(model),
        model.functions_deferred,
        legend(|word| format!("**{word}**"))
    );
    let _ = writeln!(
        out,
        "| Functions | total | proved | claimed | performed only | waived | open |"
    );
    let _ = writeln!(out, "| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    let _ = writeln!(out, "| Gmail | {} |", tally_cells(&model.functions_gmail));
    let _ = writeln!(
        out,
        "| Outlook | {} |\n",
        tally_cells(&model.functions_outlook)
    );

    let _ = writeln!(out, "### Entry points reached\n");
    let _ = writeln!(
        out,
        "| Kind | Gmail total | reached | waived | deferred | open | Outlook total | reached \
         | waived | deferred | open |"
    );
    let _ = writeln!(
        out,
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
    );
    for kind in &model.entry_points {
        let _ = writeln!(
            out,
            "| {} | {} | {} |",
            kind.kind,
            entry_tally_cells(&kind.gmail),
            entry_tally_cells(&kind.outlook)
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
        "Checks, proofs, waivers and deferrals the records do not bear out",
        &model.stale,
    );

    if !model.dead_code.is_empty() {
        let _ = writeln!(out, "### Dead code candidates\n");
        let _ = writeln!(
            out,
            "Entry points waived because nothing in the repository calls them.\n"
        );
        let _ = writeln!(out, "| Entry point | Source | Reason |");
        let _ = writeln!(out, "| --- | --- | --- |");
        for row in &model.dead_code {
            let _ = writeln!(
                out,
                "| `{}` | `{}` | {} |",
                row.entry, row.source, row.reason
            );
        }
        let _ = writeln!(out);
    }

    for (owner, rows) in owned_by_owner(model) {
        let _ = writeln!(out, "### Counted with the {owner} functions\n");
        let _ = writeln!(out, "{}\n", owned_note(owner));
        let _ = writeln!(out, "| Entry point | Source | Gmail | Outlook |");
        let _ = writeln!(out, "| --- | --- | --- | --- |");
        for row in rows {
            let _ = writeln!(
                out,
                "| `{}` | `{}` | {} | {} |",
                row.entry,
                row.source,
                reached_word(row.gmail),
                reached_word(row.outlook)
            );
        }
        let _ = writeln!(out);
    }

    // Every function, not only the open ones: what is proved is read here.
    let functions = backend_functions(model);
    let unproved = functions
        .iter()
        .filter(|row| is_gap(row.gmail.as_ref()) || is_gap(row.outlook.as_ref()))
        .count();
    let _ = writeln!(
        out,
        "<details><summary>Every backend function ({unproved} of {} not proved on a \
         provider)</summary>\n",
        functions.len()
    );
    let _ = writeln!(out, "| Function | | Gmail | Outlook |");
    let _ = writeln!(out, "| --- | --- | --- | --- |");
    for row in functions {
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} |",
            row.id,
            row.function,
            summary_cell(row, row.gmail.as_ref()),
            summary_cell(row, row.outlook.as_ref())
        );
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

fn entry_tally_cells(tally: &Tally) -> String {
    format!(
        "{} | {} | {} | {} | {}",
        tally.total, tally.covered, tally.waived, tally.deferred, tally.open
    )
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
        "<tr><th>{name}</th><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td></tr>",
        tally.total, tally.proved, tally.claimed, tally.performed, tally.waived, tally.open
    )
}

fn html_entry_tally(tally: &Tally) -> String {
    format!(
        "<td>{}</td><td>{}</td><td>{}</td><td>{}</td><td>{}</td>",
        tally.total, tally.covered, tally.waived, tally.deferred, tally.open
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
    let _ = write!(
        out,
        "<h1>Email backend coverage</h1><p><b>{}</b></p><p>{} functions of email are listed; \
         the email backend has a part in {} ({} more are carried out by other services and \
         {DEFERRED}). {} {} scenarios left a record.</p>",
        escape(&headline(model)),
        model.functions_listed,
        backend(model),
        model.functions_deferred,
        legend(|word| format!("<b>{word}</b>")),
        model.suite.recorded
    );
    let _ = write!(
        out,
        "<h2>Functions</h2><div class=\"scroll\"><table><tr><th></th><th>total</th>\
         <th>proved</th><th>claimed</th><th>performed only</th><th>waived</th><th>open</th></tr>\
         {}{}</table></div>",
        html_tally("Gmail", &model.functions_gmail),
        html_tally("Outlook", &model.functions_outlook)
    );

    let _ = write!(
        out,
        "<h2>Entry points reached</h2><div class=\"scroll\"><table><tr><th>kind</th>\
         <th>Gmail total</th><th>reached</th><th>waived</th><th>deferred</th><th>open</th>\
         <th>Outlook total</th><th>reached</th><th>waived</th><th>deferred</th><th>open</th></tr>"
    );
    for kind in &model.entry_points {
        let _ = write!(
            out,
            "<tr><th>{}</th>{}{}</tr>",
            kind.kind,
            html_entry_tally(&kind.gmail),
            html_entry_tally(&kind.outlook)
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
        "Checks, proofs, waivers and deferrals the records do not bear out",
        &model.stale,
    );

    if !model.dead_code.is_empty() {
        let _ = write!(
            out,
            "<h2>Dead code candidates</h2><p>Entry points waived because nothing in the \
             repository calls them.</p><div class=\"scroll\"><table class=\"rows\"><tr>\
             <th>entry point</th><th>reason</th></tr>"
        );
        for row in &model.dead_code {
            let _ = write!(
                out,
                "<tr><td><code>{}</code><br><small>{}</small></td><td>{}</td></tr>",
                escape(&row.entry),
                escape(&row.source),
                escape(&row.reason)
            );
        }
        let _ = write!(out, "</table></div>");
    }

    for (owner, rows) in owned_by_owner(model) {
        let _ = write!(
            out,
            "<h2>Counted with the {} functions</h2><p>{}</p><div class=\"scroll\">\
             <table class=\"rows\"><tr><th>entry point</th><th>Gmail</th><th>Outlook</th></tr>",
            escape(owner),
            escape(&owned_note(owner))
        );
        for row in rows {
            let _ = write!(
                out,
                "<tr><td><code>{}</code><br><small>{}</small></td><td>{}</td><td>{}</td></tr>",
                escape(&row.entry),
                escape(&row.source),
                reached_word(row.gmail),
                reached_word(row.outlook)
            );
        }
        let _ = write!(out, "</table></div>");
    }

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
            .or_else(|| row.deferred.as_ref().map(|service| (DEFERRED, service)));
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
