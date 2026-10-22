//! Which of the person's tools Macro can bring in during setup, and how.
//!
//! The agent names tools the way the person does ("Google Mail", "HubSpot",
//! "slack_v2"). This module turns those names into one canonical app and the
//! one way setup handles it, so every tool result speaks about apps the same
//! way.
//!
//! Tools people are leaving are imported once; tools they keep stay
//! connected and Macro works with them live. Whether a tool they're leaving
//! can be imported now is the import service's answer, not this list's: an
//! app becomes importable here as soon as the import service has a source
//! for it.

#[cfg(test)]
mod test;

use import::domain::models::ImportSource;

/// The kind of work a tool people are leaving holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Pages and wikis.
    Docs,
    /// Issues and tasks.
    Tasks,
    /// Channels and messages.
    Chat,
    /// Companies and contacts.
    Crm,
}

/// Who hosts an email inbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MailProvider {
    /// Gmail and Google Workspace.
    Gmail,
    /// Outlook and Microsoft 365.
    Outlook,
}

/// What setup can do with an app.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Support {
    /// The person's email inbox, with its calendar. Connected through Macro's
    /// own inbox flow, not through a connector.
    Inbox(MailProvider),
    /// A tool they're leaving that Macro's import service brings in once:
    /// connect, discover, plan, import.
    Import(ImportSource),
    /// A tool they're leaving that Macro can't import yet. Connected now, so
    /// it comes in once the import service can import it.
    ImportLater(Kind),
    /// A tool they keep. Connected so Macro works with it live; nothing is
    /// imported.
    Keep,
    /// A tool they keep that Macro connects outside setup's links, with what
    /// to tell the person: Calendar comes with the email link, GitHub
    /// connects in Macro's settings.
    KeepInMacro(&'static str),
}

/// What a listed app is to the person, before asking the import service.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Role {
    Inbox(MailProvider),
    Leaving(Kind),
    Keep,
    KeepInMacro(&'static str),
}

/// How a plan counts an app's items: singular and plural.
pub type Nouns = (&'static str, &'static str);

const PAGES: Nouns = ("page", "pages");
const ISSUES: Nouns = ("issue", "issues");
const TASKS: Nouns = ("task", "tasks");
const CHANNELS: Nouns = ("channel", "channels");
const COMPANIES: Nouns = ("company", "companies");
const ITEMS: Nouns = ("item", "items");

/// An app setup knows by name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KnownApp {
    /// Canonical id used in every tool result, e.g. `notion`.
    pub id: &'static str,
    /// Display name, e.g. `Notion`. Empty for an import source this list
    /// doesn't name yet; [`App::name`] derives one from the id.
    pub name: &'static str,
    /// The Pipedream app slug a connection uses, when it has one.
    pub connect_slug: Option<&'static str>,
    /// How setup handles it.
    pub support: Support,
    /// What its items are called in a plan.
    pub items: Nouns,
}

struct Entry {
    id: &'static str,
    name: &'static str,
    connect_slug: Option<&'static str>,
    role: Role,
    items: Nouns,
    aliases: &'static [&'static str],
}

const fn leaving(
    id: &'static str,
    name: &'static str,
    connect_slug: &'static str,
    kind: Kind,
    items: Nouns,
    aliases: &'static [&'static str],
) -> Entry {
    Entry {
        id,
        name,
        connect_slug: Some(connect_slug),
        role: Role::Leaving(kind),
        items,
        aliases,
    }
}

const fn keep(
    id: &'static str,
    name: &'static str,
    connect_slug: &'static str,
    aliases: &'static [&'static str],
) -> Entry {
    Entry {
        id,
        name,
        connect_slug: Some(connect_slug),
        role: Role::Keep,
        items: ITEMS,
        aliases,
    }
}

const ENTRIES: &[Entry] = &[
    Entry {
        id: "gmail",
        name: "Gmail",
        connect_slug: None,
        role: Role::Inbox(MailProvider::Gmail),
        items: ITEMS,
        // The agent signed the person in with Google, so plain "email" is
        // their Gmail; Outlook users name Outlook.
        aliases: &[
            "gmail",
            "google_mail",
            "googlemail",
            "google_workspace",
            "email",
            "mail",
        ],
    },
    Entry {
        id: "outlook",
        name: "Outlook",
        connect_slug: None,
        role: Role::Inbox(MailProvider::Outlook),
        items: ITEMS,
        aliases: &[
            "outlook",
            "microsoft_outlook",
            "outlook_mail",
            "office_365",
            "microsoft_365",
        ],
    },
    Entry {
        id: "google_calendar",
        name: "Google Calendar",
        connect_slug: None,
        role: Role::KeepInMacro(
            "comes with the email link. If calendar isn't on yet, turn it on in Macro's \
             Settings → Email (Enable calendar)",
        ),
        items: ITEMS,
        aliases: &["google_calendar", "calendar", "gcal", "gcalendar"],
    },
    Entry {
        id: "github",
        name: "GitHub",
        connect_slug: None,
        role: Role::KeepInMacro(
            "connects in Macro's Settings → Connected, not through setup; Macro works with \
             it live once it's linked",
        ),
        items: ITEMS,
        aliases: &["github", "git_hub"],
    },
    // Tools people are leaving. Each comes in once its importer exists.
    leaving("notion", "Notion", "notion", Kind::Docs, PAGES, &["notion"]),
    leaving(
        "confluence",
        "Confluence",
        "confluence",
        Kind::Docs,
        PAGES,
        &["confluence", "atlassian_confluence"],
    ),
    leaving("coda", "Coda", "coda", Kind::Docs, PAGES, &["coda"]),
    leaving(
        "linear",
        "Linear",
        "linear",
        Kind::Tasks,
        ISSUES,
        &["linear", "linear_app"],
    ),
    leaving(
        "jira",
        "Jira",
        "jira",
        Kind::Tasks,
        ISSUES,
        &["jira", "jira_software", "atlassian_jira"],
    ),
    leaving("asana", "Asana", "asana", Kind::Tasks, TASKS, &["asana"]),
    leaving(
        "clickup",
        "ClickUp",
        "clickup",
        Kind::Tasks,
        TASKS,
        &["clickup", "click_up"],
    ),
    leaving(
        "trello",
        "Trello",
        "trello",
        Kind::Tasks,
        TASKS,
        &["trello"],
    ),
    leaving(
        "monday",
        "monday.com",
        "monday",
        Kind::Tasks,
        TASKS,
        &["monday", "monday_com", "mondaycom"],
    ),
    leaving(
        "slack",
        "Slack",
        "slack_v2",
        Kind::Chat,
        CHANNELS,
        &["slack", "slack_v2"],
    ),
    leaving(
        "microsoft_teams",
        "Microsoft Teams",
        "microsoft_teams",
        Kind::Chat,
        CHANNELS,
        &["microsoft_teams", "teams", "ms_teams"],
    ),
    leaving(
        "hubspot",
        "HubSpot",
        "hubspot",
        Kind::Crm,
        COMPANIES,
        &["hubspot", "hub_spot"],
    ),
    leaving(
        "salesforce",
        "Salesforce",
        "salesforce_rest_api",
        Kind::Crm,
        COMPANIES,
        &["salesforce", "salesforce_rest_api", "sfdc"],
    ),
    leaving(
        "pipedrive",
        "Pipedrive",
        "pipedrive",
        Kind::Crm,
        COMPANIES,
        &["pipedrive"],
    ),
    leaving("attio", "Attio", "attio", Kind::Crm, COMPANIES, &["attio"]),
    leaving(
        "close",
        "Close",
        "close",
        Kind::Crm,
        COMPANIES,
        &["close", "close_crm", "close_io"],
    ),
    leaving(
        "zoho_crm",
        "Zoho CRM",
        "zoho_crm",
        Kind::Crm,
        COMPANIES,
        &["zoho_crm", "zoho"],
    ),
    leaving(
        "copper",
        "Copper",
        "copper",
        Kind::Crm,
        COMPANIES,
        &["copper", "copper_crm"],
    ),
    // Tools people keep. Connected so Macro works with them live.
    keep(
        "google_drive",
        "Google Drive",
        "google_drive",
        &[
            "google_drive",
            "gdrive",
            "drive",
            "google_docs",
            "google_sheets",
            "google_slides",
        ],
    ),
    keep("dropbox", "Dropbox", "dropbox", &["dropbox"]),
    keep(
        "onedrive",
        "OneDrive",
        "microsoft_onedrive",
        &["onedrive", "microsoft_onedrive", "one_drive"],
    ),
    keep("box", "Box", "box", &["box"]),
];

/// The import source the import service has for an app, if any.
fn import_source_for(id: &str, connect_slug: Option<&str>) -> Option<ImportSource> {
    ImportSource::all().into_iter().find(|source| {
        source.as_ref() == id
            || connect_slug.is_some_and(|slug| source.pipedream_app_slugs().contains(&slug))
    })
}

impl Entry {
    fn app(&self) -> KnownApp {
        let support = match self.role {
            Role::Inbox(provider) => Support::Inbox(provider),
            Role::Keep => Support::Keep,
            Role::KeepInMacro(note) => Support::KeepInMacro(note),
            Role::Leaving(kind) => import_source_for(self.id, self.connect_slug)
                .map_or(Support::ImportLater(kind), Support::Import),
        };
        KnownApp {
            id: self.id,
            name: self.name,
            connect_slug: self.connect_slug,
            support,
            items: self.items,
        }
    }
}

/// An app for an import source this list doesn't name yet.
fn unlisted_source(source: ImportSource) -> KnownApp {
    let slug = source.pipedream_app_slugs().first().copied();
    KnownApp {
        id: slug.unwrap_or_default(),
        name: "",
        connect_slug: slug,
        support: Support::Import(source),
        items: match source.entity_type() {
            "md" => PAGES,
            "task" => TASKS,
            "channel" => CHANNELS,
            _ => ITEMS,
        },
    }
}

/// An app the person named, resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum App {
    /// One setup knows.
    Known(KnownApp),
    /// Anything else, as a normalized slug (`basecamp`). Setup cannot import
    /// it; whether it can at least be connected depends on the connector
    /// directory.
    Other(String),
}

impl App {
    /// The canonical id used in tool results.
    pub fn id(&self) -> &str {
        match self {
            Self::Known(app) => app.id,
            Self::Other(slug) => slug,
        }
    }

    /// A display name.
    pub fn name(&self) -> String {
        match self {
            Self::Known(app) if !app.name.is_empty() => app.name.to_owned(),
            Self::Known(app) => display_name(app.id),
            Self::Other(slug) => display_name(slug),
        }
    }

    /// How setup handles the app; `None` for apps it doesn't know.
    pub fn support(&self) -> Option<Support> {
        match self {
            Self::Known(app) => Some(app.support),
            Self::Other(_) => None,
        }
    }

    /// The import source behind the app, when Macro can import it.
    pub fn import_source(&self) -> Option<ImportSource> {
        match self.support() {
            Some(Support::Import(source)) => Some(source),
            _ => None,
        }
    }

    /// The slug a connector connection uses: the known app's Pipedream slug,
    /// or an unknown app's own slug. `None` for apps that don't connect
    /// through a connector.
    pub fn connect_slug(&self) -> Option<&str> {
        match self {
            Self::Known(app) => app.connect_slug,
            Self::Other(slug) => Some(slug),
        }
    }
}

/// `Google Docs`, `google-docs` and `google_docs` all become `google_docs`.
pub fn normalize(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    for ch in name.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch.to_ascii_lowercase());
        } else if !slug.ends_with('_') && !slug.is_empty() {
            slug.push('_');
        }
    }
    slug.trim_end_matches('_').to_owned()
}

fn display_name(slug: &str) -> String {
    slug.split('_')
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            chars
                .next()
                .map(|first| first.to_ascii_uppercase().to_string() + chars.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Resolves a name the person or agent used. Empty names resolve to nothing.
pub fn resolve(name: &str) -> Option<App> {
    let slug = normalize(name);
    if slug.is_empty() {
        return None;
    }
    if let Some(entry) = ENTRIES
        .iter()
        .find(|entry| entry.aliases.contains(&slug.as_str()))
    {
        return Some(App::Known(entry.app()));
    }
    Some(match import_source_for(&slug, Some(&slug)) {
        Some(source) => App::Known(for_source(source)),
        None => App::Other(slug),
    })
}

/// The app an import source belongs to.
pub fn for_source(source: ImportSource) -> KnownApp {
    ENTRIES
        .iter()
        .map(Entry::app)
        .find(|app| app.support == Support::Import(source))
        .unwrap_or_else(|| unlisted_source(source))
}

/// The display name of the app an import source belongs to.
pub fn source_name(source: ImportSource) -> String {
    App::Known(for_source(source)).name()
}

/// The apps Macro can import from now, as the import service says.
pub fn importable() -> Vec<KnownApp> {
    ImportSource::all().into_iter().map(for_source).collect()
}

/// Resolves a list of names, dropping blanks and duplicates while keeping the
/// order the agent gave.
pub fn resolve_all(names: &[String]) -> Vec<App> {
    let mut apps: Vec<App> = Vec::new();
    for app in names.iter().filter_map(|name| resolve(name)) {
        if !apps.iter().any(|seen| seen.id() == app.id()) {
            apps.push(app);
        }
    }
    apps
}
