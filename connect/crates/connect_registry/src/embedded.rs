use super::EmbeddedApp;

pub(super) const EMBEDDED: &[EmbeddedApp] = &[
    EmbeddedApp {
        directory: "apify",
        toml: include_str!("../../../registry/apps/apify/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/apify/icon.svg")),
    },
    EmbeddedApp {
        directory: "airtable",
        toml: include_str!("../../../registry/apps/airtable/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/airtable/icon.svg")),
    },
    EmbeddedApp {
        directory: "apollo",
        toml: include_str!("../../../registry/apps/apollo/app.toml"),
        icon_svg: None,
    },
    EmbeddedApp {
        directory: "attio",
        toml: include_str!("../../../registry/apps/attio/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/attio/icon.svg")),
    },
    EmbeddedApp {
        directory: "calendly",
        toml: include_str!("../../../registry/apps/calendly/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/calendly/icon.svg")),
    },
    EmbeddedApp {
        directory: "canva",
        toml: include_str!("../../../registry/apps/canva/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/canva/icon.svg")),
    },
    EmbeddedApp {
        directory: "clickup",
        toml: include_str!("../../../registry/apps/clickup/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/clickup/icon.svg")),
    },
    EmbeddedApp {
        directory: "cloudflare",
        toml: include_str!("../../../registry/apps/cloudflare/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/cloudflare/icon.svg")),
    },
    EmbeddedApp {
        directory: "coda",
        toml: include_str!("../../../registry/apps/coda/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/coda/icon.svg")),
    },
    EmbeddedApp {
        directory: "confluence",
        toml: include_str!("../../../registry/apps/confluence/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/confluence/icon.svg")),
    },
    EmbeddedApp {
        directory: "datadog",
        toml: include_str!("../../../registry/apps/datadog/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/datadog/icon.svg")),
    },
    EmbeddedApp {
        directory: "dropbox",
        toml: include_str!("../../../registry/apps/dropbox/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/dropbox/icon.svg")),
    },
    EmbeddedApp {
        directory: "exa",
        toml: include_str!("../../../registry/apps/exa/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/exa/icon.svg")),
    },
    EmbeddedApp {
        directory: "fathom",
        toml: include_str!("../../../registry/apps/fathom/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/fathom/icon.svg")),
    },
    EmbeddedApp {
        directory: "github",
        toml: include_str!("../../../registry/apps/github/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/github/icon.svg")),
    },
    EmbeddedApp {
        directory: "grafana",
        toml: include_str!("../../../registry/apps/grafana/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/grafana/icon.svg")),
    },
    EmbeddedApp {
        directory: "granola",
        toml: include_str!("../../../registry/apps/granola/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/granola/icon.svg")),
    },
    EmbeddedApp {
        directory: "highlevel",
        toml: include_str!("../../../registry/apps/highlevel/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/highlevel/icon.svg")),
    },
    EmbeddedApp {
        directory: "intercom",
        toml: include_str!("../../../registry/apps/intercom/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/intercom/icon.svg")),
    },
    EmbeddedApp {
        directory: "jira",
        toml: include_str!("../../../registry/apps/jira/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/jira/icon.svg")),
    },
    EmbeddedApp {
        directory: "klaviyo",
        toml: include_str!("../../../registry/apps/klaviyo/app.toml"),
        icon_svg: None,
    },
    EmbeddedApp {
        directory: "linear",
        toml: include_str!("../../../registry/apps/linear/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/linear/icon.svg")),
    },
    EmbeddedApp {
        directory: "mailchimp",
        toml: include_str!("../../../registry/apps/mailchimp/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/mailchimp/icon.svg")),
    },
    EmbeddedApp {
        directory: "monday",
        toml: include_str!("../../../registry/apps/monday/app.toml"),
        icon_svg: None,
    },
    EmbeddedApp {
        directory: "netlify",
        toml: include_str!("../../../registry/apps/netlify/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/netlify/icon.svg")),
    },
    EmbeddedApp {
        directory: "notion",
        toml: include_str!("../../../registry/apps/notion/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/notion/icon.svg")),
    },
    EmbeddedApp {
        directory: "paypal",
        toml: include_str!("../../../registry/apps/paypal/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/paypal/icon.svg")),
    },
    EmbeddedApp {
        directory: "pipedrive",
        toml: include_str!("../../../registry/apps/pipedrive/app.toml"),
        icon_svg: None,
    },
    EmbeddedApp {
        directory: "posthog",
        toml: include_str!("../../../registry/apps/posthog/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/posthog/icon.svg")),
    },
    EmbeddedApp {
        directory: "quo",
        toml: include_str!("../../../registry/apps/quo/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/quo/icon.svg")),
    },
    EmbeddedApp {
        directory: "sentry",
        toml: include_str!("../../../registry/apps/sentry/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/sentry/icon.svg")),
    },
    EmbeddedApp {
        directory: "shopify",
        toml: include_str!("../../../registry/apps/shopify/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/shopify/icon.svg")),
    },
    EmbeddedApp {
        directory: "slack",
        toml: include_str!("../../../registry/apps/slack/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/slack/icon.svg")),
    },
    EmbeddedApp {
        directory: "square",
        toml: include_str!("../../../registry/apps/square/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/square/icon.svg")),
    },
    EmbeddedApp {
        directory: "stripe",
        toml: include_str!("../../../registry/apps/stripe/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/stripe/icon.svg")),
    },
    EmbeddedApp {
        directory: "supabase",
        toml: include_str!("../../../registry/apps/supabase/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/supabase/icon.svg")),
    },
    EmbeddedApp {
        directory: "todoist",
        toml: include_str!("../../../registry/apps/todoist/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/todoist/icon.svg")),
    },
    EmbeddedApp {
        directory: "trello",
        toml: include_str!("../../../registry/apps/trello/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/trello/icon.svg")),
    },
    EmbeddedApp {
        directory: "typeform",
        toml: include_str!("../../../registry/apps/typeform/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/typeform/icon.svg")),
    },
    EmbeddedApp {
        directory: "webflow",
        toml: include_str!("../../../registry/apps/webflow/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/webflow/icon.svg")),
    },
    EmbeddedApp {
        directory: "zendesk",
        toml: include_str!("../../../registry/apps/zendesk/app.toml"),
        icon_svg: Some(include_str!("../../../registry/apps/zendesk/icon.svg")),
    },
];
