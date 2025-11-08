//! Custom URL parsers for services that embed document titles in their URLs
//! rather than in their HTML metadata.

use url::Url;

/// Parses Notion URLs to extract document titles
/// Supports formats like:
/// - notion.so/workspace/Title-With-Dashes-uuid
/// - notion.so/Title-With-Dashes-uuid  
pub fn parse_notion_title(url: &str) -> Option<String> {
    let parsed_url = Url::parse(url).ok()?;

    // Check if this is a Notion domain
    if !parsed_url.host_str()?.contains("notion.so") {
        return None;
    }

    let path = parsed_url.path();
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // Look for the last segment that contains both a title and UUID
    // Pattern: [workspace/]title-with-dashes-uuid
    let title_segment = segments.iter().rev().find(|segment| {
        // Check if segment has UUID pattern at the end (32 hex chars without dashes)
        segment.len() > 32
            && segment
                .chars()
                .rev()
                .take(32)
                .all(|c| c.is_ascii_hexdigit())
    })?;

    // Extract title part (everything before the last 33 characters: -uuid)
    if title_segment.len() > 33 {
        let title_part = &title_segment[..title_segment.len() - 33];
        let title = title_part.replace('-', " ");
        // Capitalize first letter of each word
        let formatted_title = title
            .split_whitespace()
            .map(|word| {
                let mut chars: Vec<char> = word.chars().collect();
                if !chars.is_empty() {
                    chars[0] = chars[0].to_uppercase().next().unwrap_or(chars[0]);
                }
                chars.into_iter().collect::<String>()
            })
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

    // Check if this is a Figma domain
    if !parsed_url.host_str()?.contains("figma.com") {
        return None;
    }

    let path = parsed_url.path();
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // Pattern: figma.com/design/file-id/title-with-dashes
    if segments.len() >= 3 && segments[0] == "design" {
        let title_segment = segments[2];
        let title = title_segment.replace('-', " ");
        // Capitalize first letter of each word
        let formatted_title = title
            .split_whitespace()
            .map(|word| {
                let mut chars: Vec<char> = word.chars().collect();
                if !chars.is_empty() {
                    chars[0] = chars[0].to_uppercase().next().unwrap_or(chars[0]);
                }
                chars.into_iter().collect::<String>()
            })
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

    // Check if this is a Linear domain
    if !parsed_url.host_str()?.contains("linear.app") {
        return None;
    }

    let path = parsed_url.path();
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();

    // Pattern: linear.app/team/issue/ticket-id/title-with-dashes
    if segments.len() >= 4 && segments[1] == "issue" {
        let title_segment = segments[3];
        let title = title_segment.replace('-', " ");
        // Capitalize first letter of each word
        let formatted_title = title
            .split_whitespace()
            .map(|word| {
                let mut chars: Vec<char> = word.chars().collect();
                if !chars.is_empty() {
                    chars[0] = chars[0].to_uppercase().next().unwrap_or(chars[0]);
                }
                chars.into_iter().collect::<String>()
            })
            .collect::<Vec<String>>()
            .join(" ");

        if !formatted_title.is_empty() {
            return Some(formatted_title);
        }
    }

    None
}

/// Attempts to parse a title from the URL using custom parsers for known services
/// Returns the service name as fallback if parsing fails
pub fn parse_custom_title(url: &str) -> Option<String> {
    let parsed_url = Url::parse(url).ok()?;
    let host = parsed_url.host_str()?;

    // Try Notion parser
    if host.contains("notion.so") {
        if let Some(title) = parse_notion_title(url) {
            return Some(title);
        }
        return Some("Notion".to_string());
    }

    // Try Figma parser
    if host.contains("figma.com") {
        if let Some(title) = parse_figma_title(url) {
            return Some(title);
        }
        return Some("Figma".to_string());
    }

    // Try Linear parser
    if host.contains("linear.app") {
        if let Some(title) = parse_linear_title(url) {
            return Some(title);
        }
        return Some("Linear".to_string());
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_notion_title_parsing() {
        // Test with workspace
        let url1 = "https://www.notion.so/macrocom/Enterprise-Product-Bottlenecks-5acb869109a747c1a1a92bbf1891ff2d";
        assert_eq!(
            parse_notion_title(url1),
            Some("Enterprise Product Bottlenecks".to_string())
        );

        // Test without workspace
        let url2 = "https://www.notion.so/Macro-Work-Thoughts-e52b32630b2e45fab665b3e5c566cf3b";
        assert_eq!(
            parse_notion_title(url2),
            Some("Macro Work Thoughts".to_string())
        );

        // Test with longer workspace name
        let url3 = "https://www.notion.so/craft-ventures/Craft-Ventures-Operating-Playbooks-9db7bdccfc0f47be96076c122513691c";
        assert_eq!(
            parse_notion_title(url3),
            Some("Craft Ventures Operating Playbooks".to_string())
        );

        // Test invalid URL
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

        // Test invalid URL
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

        // Test invalid URL
        assert_eq!(parse_linear_title("https://google.com"), None);
    }

    #[test]
    fn test_custom_title_fallback() {
        // Test that it returns service name when parsing fails
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

        // Test that it returns None for non-supported services
        assert_eq!(parse_custom_title("https://google.com"), None);
    }
}
