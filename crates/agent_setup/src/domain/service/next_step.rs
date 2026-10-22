//! The one `next_step` an agent follows after `SetupGetState` and
//! `SetupDiscover`, worked out from the state alone.

use super::super::{
    catalog::{self, App},
    models::{AppDiscovery, AppStage, AppSummary, DiscoveryStatus, SupportKind},
};

/// The apps as a list an agent can paste into a call: `"notion", "linear"`.
pub(super) fn quoted_list(apps: &[String]) -> String {
    apps.iter()
        .map(|app| format!("\"{app}\""))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Names joined for a sentence: "A", "A and B", "A, B and C".
fn joined(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [one] => one.clone(),
        [rest @ .., last] => format!("{} and {last}", rest.join(", ")),
    }
}

/// What `SetupGetState` tells the agent.
pub(super) struct StateStep {
    /// What is still missing, for the person.
    pub missing: Vec<String>,
    /// The one thing to do next.
    pub next_step: String,
    /// Nothing is left for setup to do, so it counts as finished.
    pub finished: bool,
}

/// What is missing and the one step to take next, given the setup's apps.
/// `team_link` is where the person creates a Macro team.
pub(super) fn after_state(
    no_apps_named: bool,
    apps: &[AppSummary],
    has_team: bool,
    team_link: &str,
) -> StateStep {
    // Slack channels become team channels, so without a team Slack can't
    // come in yet. It never holds up the rest of setup.
    let blocked = |app: &AppSummary| !has_team && app.app == "slack";
    let mut missing = Vec::new();
    for app in apps {
        if app.stage == AppStage::NotConnected {
            missing.push(format!("{} is not connected", app.name));
        }
    }
    if apps.iter().any(blocked) {
        missing.push("Slack needs a Macro team before its channels can come in".to_owned());
    }

    let ids = |stage: AppStage| -> Vec<String> {
        apps.iter()
            .filter(|app| app.stage == stage && !blocked(app))
            .map(|app| app.app.clone())
            .collect()
    };
    let unconnected = |kinds: &[SupportKind]| -> Vec<&AppSummary> {
        apps.iter()
            .filter(|app| {
                app.stage == AppStage::NotConnected && kinds.contains(&app.support) && !blocked(app)
            })
            .collect()
    };
    // Links go out for what setup brings in. Tools that import nothing today
    // are optional, so they never hold up the rest.
    let to_connect: Vec<String> = unconnected(&[SupportKind::Import, SupportKind::Inbox])
        .into_iter()
        .map(|app| app.app.clone())
        .collect();
    let optional = unconnected(&[SupportKind::ImportLater, SupportKind::Keep]);
    let optional_ids: Vec<String> = optional.iter().map(|app| app.app.clone()).collect();
    let optional_names: Vec<String> = optional.iter().map(|app| app.name.clone()).collect();
    let names = |kinds: &[SupportKind]| -> Vec<String> {
        apps.iter()
            .filter(|app| kinds.contains(&app.support))
            .map(|app| app.name.clone())
            .collect()
    };
    let kept = names(&[SupportKind::Keep]);
    let later = names(&[SupportKind::ImportLater]);
    let not_importable = names(&[SupportKind::ConnectOnly, SupportKind::Unsupported]);
    let to_discover = ids(AppStage::Connected);
    let discovering = ids(AppStage::Discovering);
    let failed = ids(AppStage::DiscoveryFailed);
    let ready = ids(AppStage::ReadyForPlan);
    let importing = ids(AppStage::Importing);
    let report = "Then call SetupGetStatus with the same apps for the final report.";

    let step = |next_step: String, finished: bool| (next_step, finished);
    let (next_step, finished) = if no_apps_named && apps.is_empty() {
        step(
            "Find the person's tools in your other connected tools (docs, task trackers, chat, \
             CRM, email, calendar, file storage); ask only if you can't tell. Then call \
             SetupGetState(apps: [...]) with them."
                .to_owned(),
            false,
        )
    } else if !to_connect.is_empty() {
        let mut text = format!(
            "Call SetupConnect(apps: [{}]) and show the person every link in one message.",
            quoted_list(&to_connect)
        );
        if !optional.is_empty() {
            text.push_str(&format!(
                " {} import nothing today; add {} to the same call only if the person wants \
                 Macro to work with them live.",
                joined(&optional_names),
                quoted_list(&optional_ids)
            ));
        }
        step(text, false)
    } else if !to_discover.is_empty() || !failed.is_empty() {
        let mut apps = to_discover.clone();
        apps.extend(failed.iter().cloned());
        step(
            format!(
                "Call SetupConnect(apps: [{}]): they're connected, and that starts Macro looking \
                 through them{}.",
                quoted_list(&apps),
                if failed.is_empty() {
                    ""
                } else {
                    " (again, where it failed)"
                }
            ),
            false,
        )
    } else if !discovering.is_empty() {
        step(
            format!(
                "Call SetupDiscover(apps: [{}]); it waits for Macro to finish looking.",
                quoted_list(&discovering)
            ),
            false,
        )
    } else if !ready.is_empty() {
        missing.push("The plan is not approved yet".to_owned());
        step(
            format!(
                "Call SetupDiscover(apps: [{}]), then SetupProposePlan with every candidate \
                 (all: true) unless the person narrowed it, and ask for one approval.",
                quoted_list(&ready)
            ),
            false,
        )
    } else if !importing.is_empty() {
        step(
            "Items are copying in. Call SetupGetStatus with the same apps; it waits and returns \
             the report."
                .to_owned(),
            false,
        )
    } else {
        let mut told = Vec::new();
        if apps.iter().any(blocked) {
            told.push(format!(
                "Slack needs a Macro team first: once the person creates one at {team_link}, \
                 running setup again brings its channels in."
            ));
        }
        if !kept.is_empty() {
            told.push(format!(
                "{} {} where {} {}: Macro works with {} live and copies nothing in.",
                joined(&kept),
                if kept.len() == 1 { "stays" } else { "stay" },
                if kept.len() == 1 { "it" } else { "they" },
                if kept.len() == 1 { "is" } else { "are" },
                if kept.len() == 1 { "it" } else { "them" },
            ));
        }
        if !later.is_empty() {
            told.push(format!(
                "Macro can't import {} yet; once connected, running setup again brings {} in \
                 when it can.",
                joined(&later),
                if later.len() == 1 { "it" } else { "them" },
            ));
        }
        if !not_importable.is_empty() {
            told.push(format!(
                "Macro can't import {}; give the alternative in each app's note.",
                joined(&not_importable)
            ));
        }
        if !optional.is_empty() {
            told.push(format!(
                "{} {} connected; SetupConnect(apps: [{}]) gives a link if the person wants that.",
                joined(&optional_names),
                if optional.len() == 1 {
                    "isn't"
                } else {
                    "aren't"
                },
                quoted_list(&optional_ids)
            ));
        }
        let text = if told.is_empty() {
            format!("Nothing is left to set up for these apps. {report}")
        } else {
            let importable: Vec<String> = catalog::importable()
                .into_iter()
                .map(|app| App::Known(app).name())
                .collect();
            format!(
                "Tell the person plainly: {} Macro imports {} today; if your other connected \
                 tools show they use any of those, call SetupGetState with them. Don't copy their \
                 files or records in yourself. {report}",
                told.join(" "),
                joined(&importable)
            )
        };
        step(text, true)
    };
    StateStep {
        missing,
        next_step,
        finished,
    }
}

/// The next step after discovery.
pub(super) fn after_discovery(results: &[AppDiscovery]) -> String {
    let discovering: Vec<String> = results
        .iter()
        .filter(|app| app.status == DiscoveryStatus::Discovering)
        .map(|app| app.app.clone())
        .collect();
    let not_connected: Vec<String> = results
        .iter()
        .filter(|app| {
            matches!(
                app.status,
                DiscoveryStatus::NotConnected | DiscoveryStatus::NotStarted
            )
        })
        .map(|app| app.app.clone())
        .collect();
    if !discovering.is_empty() {
        return format!(
            "Macro is still looking through {}. Call SetupDiscover(apps: [{}]) again; it waits \
             for results.",
            discovering.join(" and "),
            quoted_list(&discovering)
        );
    }
    if !not_connected.is_empty() {
        return format!(
            "Connect these first: call SetupConnect(apps: [{}]) and show the person the links.",
            quoted_list(&not_connected)
        );
    }
    if results
        .iter()
        .any(|app| app.status == DiscoveryStatus::Ready)
    {
        return "Call SetupProposePlan with all: true for each app unless the person narrowed it \
                (then their refs), declined refs for anything they said no to, and other_apps for \
                tools setup doesn't import. Put any real question in the plan message, not before."
            .to_owned();
    }
    "There is nothing new to import. Call SetupGetStatus with the same apps and report to the \
     person."
        .to_owned()
}
