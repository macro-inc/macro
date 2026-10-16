//! Custom URL parsers for services that embed document titles in their URLs
//! rather than in their HTML metadata, and for services that support
//! iframe-embeddable content (video players, etc.).

use url::Url;

/// The type of embeddable content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmbedType {
    /// Video content (Loom, Supercut).
    Video,
}

/// Information about embeddable content for a URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbedInfo {
    /// The type of embeddable content.
    pub embed_type: EmbedType,
    /// The URL to use in an iframe for embedding.
    pub embed_url: String,
}

/// Validates that the hostname matches a provider domain exactly or is a
/// subdomain of it. Rejects lookalike domains (e.g. `loom.com.evil.example`).
fn is_valid_provider_host(host: &str, provider_domain: &str) -> bool {
    host == provider_domain || host.ends_with(&format!(".{}", provider_domain))
}

/// Parses Notion URLs to extract document titles
/// Supports formats like:
/// - notion.so/workspace/Title-With-Dashes-uuid
/// - notion.so/Title-With-Dashes-uuid
pub fn parse_notion_title(url: &str) -> Option<String> {
    let parsed_url = Url::parse(url).ok()?;
    let host = parsed_url.host_str()?;

    if !is_valid_provider_host(host, "notion.so") {
        return None;
    }

    let path = parsed_url.path();
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    let title_segment = segments.iter().rev().find(|segment| {
        // UUID at end is 32 hex chars without dashes
        segment.len() > 32
            && segment
                .chars()
                .rev()
                .take(32)
                .all(|c| c.is_ascii_hexdigit())
    })?;

    if title_segment.len() > 33 {
        let title_part = &title_segment[..title_segment.len() - 33];
        let title = title_part.replace('-', " ");
        let formatted_title = title
            .split_whitespace()
            .map(capitalize_first)
            .collect::<Vec<String>>()
            .join(" ");

        if !formatted_title.is_empty() {
            return Some(formatted_title);
        }
    }

    None
}

/// Parses Figma URLs to extract design titles
/// Supports formats like:
/// - figma.com/design/file-id/Title-With-Dashes?...
pub fn parse_figma_title(url: &str) -> Option<String> {
    let parsed_url = Url::parse(url).ok()?;
    let host = parsed_url.host_str()?;

    if !is_valid_provider_host(host, "figma.com") {
        return None;
    }

    let path = parsed_url.path();
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    if segments.len() >= 3 && segments[0] == "design" {
        let title_segment = segments[2];
        let title = title_segment.replace('-', " ");
        let formatted_title = title
            .split_whitespace()
            .map(capitalize_first)
            .collect::<Vec<String>>()
            .join(" ");

        if !formatted_title.is_empty() {
            return Some(formatted_title);
        }
    }

    None
}

/// Parses Linear URLs to extract issue titles
/// Supports formats like:
/// - linear.app/team/issue/ticket-id/title-with-dashes
pub fn parse_linear_title(url: &str) -> Option<String> {
    let parsed_url = Url::parse(url).ok()?;
    let host = parsed_url.host_str()?;

    if !is_valid_provider_host(host, "linear.app") {
        return None;
    }

    let path = parsed_url.path();
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    if segments.len() >= 4 && segments[1] == "issue" {
        let title_segment = segments[3];
        let title = title_segment.replace('-', " ");
        let formatted_title = title
            .split_whitespace()
            .map(capitalize_first)
            .collect::<Vec<String>>()
            .join(" ");

        if !formatted_title.is_empty() {
            return Some(formatted_title);
        }
    }

    None
}

/// Parses Supercut share URLs to generate embed URLs.
///
/// Supercut share URLs follow the pattern:
/// - `supercut.ai/share/{workspace}/{video_id}`
///
/// The embed URL uses the format:
/// - `supercut.ai/embed/{workspace}/{video_id}`
pub fn parse_supercut_embed(url: &str) -> Option<EmbedInfo> {
    let parsed_url = Url::parse(url).ok()?;
    let host = parsed_url.host_str()?;

    if !is_valid_provider_host(host, "supercut.ai") {
        return None;
    }

    let path = parsed_url.path();
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // Match /share/{workspace}/{video_id}
    if segments.len() >= 3 && segments[0] == "share" {
        let workspace = segments[1];
        let video_id = segments[2];

        let embed_url = format!("https://supercut.ai/embed/{}/{}", workspace, video_id);
        return Some(EmbedInfo {
            embed_type: EmbedType::Video,
            embed_url,
        });
    }

    None
}

/// Parses Loom share URLs to generate embed URLs.
///
/// Loom share URLs follow the pattern:
/// - `loom.com/share/{video_id}`
/// - `www.loom.com/share/{video_id}`
///
/// The embed URL uses the format:
/// - `loom.com/embed/{video_id}`
pub fn parse_loom_embed(url: &str) -> Option<EmbedInfo> {
    let parsed_url = Url::parse(url).ok()?;
    let host = parsed_url.host_str()?;

    if !is_valid_provider_host(host, "loom.com") {
        return None;
    }

    let path = parsed_url.path();
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // Match /share/{video_id}
    if segments.len() >= 2 && segments[0] == "share" {
        let video_id = segments[1];

        let embed_url = format!("https://www.loom.com/embed/{}", video_id);
        return Some(EmbedInfo {
            embed_type: EmbedType::Video,
            embed_url,
        });
    }

    None
}

/// Attempts to parse embed information from the URL for services that support
/// iframe embedding (Loom, Supercut, etc.).
pub fn parse_embed_info(url: &str) -> Option<EmbedInfo> {
    if let Some(info) = parse_supercut_embed(url) {
        return Some(info);
    }

    if let Some(info) = parse_loom_embed(url) {
        return Some(info);
    }

    None
}

/// Attempts to parse a title from the URL using custom parsers for known services.
/// Returns the service name as fallback if parsing fails on a recognized host.
pub fn parse_custom_title(url: &str) -> Option<String> {
    let parsed_url = Url::parse(url).ok()?;
    let host = parsed_url.host_str()?;

    if is_valid_provider_host(host, "notion.so") {
        if let Some(title) = parse_notion_title(url) {
            return Some(title);
        }
        return Some("Notion".to_string());
    }

    if is_valid_provider_host(host, "figma.com") {
        if let Some(title) = parse_figma_title(url) {
            return Some(title);
        }
        return Some("Figma".to_string());
    }

    if is_valid_provider_host(host, "linear.app") {
        if let Some(title) = parse_linear_title(url) {
            return Some(title);
        }
        return Some("Linear".to_string());
    }

    // For video services, return a fallback title.
    if is_valid_provider_host(host, "supercut.ai") {
        return Some("Supercut".to_string());
    }

    if is_valid_provider_host(host, "loom.com") {
        return Some("Loom".to_string());
    }

    None
}

fn capitalize_first(word: &str) -> String {
    let mut chars: Vec<char> = word.chars().collect();
    if !chars.is_empty() {
        chars[0] = chars[0].to_uppercase().next().unwrap_or(chars[0]);
    }
    chars.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_notion_title_parsing() {
        let url1 = "https://www.notion.so/macrocom/Enterprise-Product-Bottlenecks-5acb869109a747c1a1a92bbf1891ff2d";
        assert_eq!(
            parse_notion_title(url1),
            Some("Enterprise Product Bottlenecks".to_string())
        );

        let url2 = "https://www.notion.so/Macro-Work-Thoughts-e52b32630b2e45fab665b3e5c566cf3b";
        assert_eq!(
            parse_notion_title(url2),
            Some("Macro Work Thoughts".to_string())
        );

        let url3 = "https://www.notion.so/craft-ventures/Craft-Ventures-Operating-Playbooks-9db7bdccfc0f47be96076c122513691c";
        assert_eq!(
            parse_notion_title(url3),
            Some("Craft Ventures Operating Playbooks".to_string())
        );

        assert_eq!(parse_notion_title("https://google.com"), None);
    }

    #[test]
    fn test_figma_title_parsing() {
        let url1 = "https://www.figma.com/design/Kf1Vep5riU3re2GO4E0q6b/Peter-Copy-of-Paper-Crowns?node-id=0-1&p=f&t=Z2dZh8AyxauKitCl-0";
        assert_eq!(
            parse_figma_title(url1),
            Some("Peter Copy Of Paper Crowns".to_string())
        );

        let url2 = "https://www.figma.com/design/VWgAP7zMauuWKkeS3CmWk3/AI-side-panel?node-id=0-1&p=f&t=SqdP6D2w2rZ5iSjV-0";
        assert_eq!(parse_figma_title(url2), Some("AI Side Panel".to_string()));

        assert_eq!(parse_figma_title("https://google.com"), None);
    }

    #[test]
    fn test_linear_title_parsing() {
        let url1 = "https://linear.app/macro-eng/issue/M-3586/ability-to-archive-emails";
        assert_eq!(
            parse_linear_title(url1),
            Some("Ability To Archive Emails".to_string())
        );

        let url2 = "https://linear.app/macro-eng/issue/M-3421/add-macro-permissions-to-jwt-token";
        assert_eq!(
            parse_linear_title(url2),
            Some("Add Macro Permissions To Jwt Token".to_string())
        );

        assert_eq!(parse_linear_title("https://google.com"), None);
    }

    #[test]
    fn test_custom_title_fallback() {
        assert_eq!(
            parse_custom_title("https://www.notion.so"),
            Some("Notion".to_string())
        );
        assert_eq!(
            parse_custom_title("https://www.figma.com"),
            Some("Figma".to_string())
        );
        assert_eq!(
            parse_custom_title("https://linear.app"),
            Some("Linear".to_string())
        );
        assert_eq!(
            parse_custom_title("https://supercut.ai"),
            Some("Supercut".to_string())
        );
        assert_eq!(
            parse_custom_title("https://www.loom.com"),
            Some("Loom".to_string())
        );
        assert_eq!(parse_custom_title("https://google.com"), None);
    }

    #[test]
    fn test_supercut_embed_parsing() {
        // Standard share URL
        let url1 = "https://supercut.ai/share/onsteroids/zvAqfSVFnB7vUh71Sfqhq4";
        let result1 = parse_supercut_embed(url1);
        assert!(result1.is_some());
        let info1 = result1.unwrap();
        assert_eq!(info1.embed_type, EmbedType::Video);
        assert_eq!(
            info1.embed_url,
            "https://supercut.ai/embed/onsteroids/zvAqfSVFnB7vUh71Sfqhq4"
        );

        // Another workspace
        let url2 = "https://supercut.ai/share/float-labs/tOgpqhASaBW3FwM5v8NKTb";
        let result2 = parse_supercut_embed(url2);
        assert!(result2.is_some());
        let info2 = result2.unwrap();
        assert_eq!(
            info2.embed_url,
            "https://supercut.ai/embed/float-labs/tOgpqhASaBW3FwM5v8NKTb"
        );

        // Non-share URL should return None
        assert!(parse_supercut_embed("https://supercut.ai").is_none());
        assert!(parse_supercut_embed("https://supercut.ai/about").is_none());

        // Non-Supercut URL should return None
        assert!(parse_supercut_embed("https://google.com/share/abc/def").is_none());
    }

    #[test]
    fn test_loom_embed_parsing() {
        // Standard share URL
        let url1 = "https://www.loom.com/share/e5b8c04bca094dd8a5507925ab887002";
        let result1 = parse_loom_embed(url1);
        assert!(result1.is_some());
        let info1 = result1.unwrap();
        assert_eq!(info1.embed_type, EmbedType::Video);
        assert_eq!(
            info1.embed_url,
            "https://www.loom.com/embed/e5b8c04bca094dd8a5507925ab887002"
        );

        // Without www
        let url2 = "https://loom.com/share/abc123def456";
        let result2 = parse_loom_embed(url2);
        assert!(result2.is_some());
        let info2 = result2.unwrap();
        assert_eq!(info2.embed_url, "https://www.loom.com/embed/abc123def456");

        // Non-share URL should return None
        assert!(parse_loom_embed("https://www.loom.com").is_none());
        assert!(parse_loom_embed("https://www.loom.com/about").is_none());

        // Non-Loom URL should return None
        assert!(parse_loom_embed("https://google.com/share/abc").is_none());
    }

    #[test]
    fn test_parse_embed_info() {
        // Supercut
        let supercut_result = parse_embed_info("https://supercut.ai/share/workspace/video123");
        assert!(supercut_result.is_some());
        assert_eq!(supercut_result.unwrap().embed_type, EmbedType::Video);

        // Loom
        let loom_result = parse_embed_info("https://www.loom.com/share/video456");
        assert!(loom_result.is_some());
        assert_eq!(loom_result.unwrap().embed_type, EmbedType::Video);

        // Non-embeddable URL
        assert!(parse_embed_info("https://google.com").is_none());
        assert!(parse_embed_info("https://www.notion.so/page").is_none());
    }

    #[test]
    fn test_hostname_validation_rejects_lookalikes() {
        // Lookalike domains should be rejected (not substrings)
        assert!(parse_supercut_embed("https://supercut.ai.evil.example/share/ws/id").is_none());
        assert!(parse_supercut_embed("https://fake-supercut.ai/share/ws/id").is_none());
        assert!(parse_loom_embed("https://loom.com.evil.example/share/id").is_none());
        assert!(parse_loom_embed("https://fake-loom.com/share/id").is_none());

        // Valid subdomains should still work
        assert!(parse_supercut_embed("https://app.supercut.ai/share/ws/id").is_some());
        assert!(parse_loom_embed("https://app.loom.com/share/id").is_some());

        // Title fallbacks should also reject lookalikes
        assert!(parse_custom_title("https://supercut.ai.evil.example").is_none());
        assert!(parse_custom_title("https://loom.com.evil.example").is_none());

        // But valid providers should work
        assert_eq!(
            parse_custom_title("https://supercut.ai"),
            Some("Supercut".to_string())
        );
        assert_eq!(
            parse_custom_title("https://loom.com"),
            Some("Loom".to_string())
        );
    }
}
