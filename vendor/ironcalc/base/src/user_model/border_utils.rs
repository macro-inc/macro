use crate::types::{BorderItem, Color};

fn parse_color(s: &str) -> Option<(u8, u8, u8)> {
    let s = s.trim_start_matches('#');
    match s.len() {
        6 => {
            let r = u8::from_str_radix(&s[0..2], 16).ok()?;
            let g = u8::from_str_radix(&s[2..4], 16).ok()?;
            let b = u8::from_str_radix(&s[4..6], 16).ok()?;
            Some((r, g, b))
        }
        3 => {
            let r = u8::from_str_radix(&s[0..1], 16).ok()?;
            let g = u8::from_str_radix(&s[1..2], 16).ok()?;
            let b = u8::from_str_radix(&s[2..3], 16).ok()?;
            // Expand single hex digits to full bytes
            Some((r * 17, g * 17, b * 17))
        }
        _ => None,
    }
}

fn compute_luminance(r: u8, g: u8, b: u8) -> f64 {
    // Normalize RGB values to [0, 1]
    let r = r as f64 / 255.0;
    let g = g as f64 / 255.0;
    let b = b as f64 / 255.0;
    // Calculate luminance using the Rec. 601 formula
    0.299 * r + 0.587 * g + 0.114 * b
}

fn is_max_color(a: &Color, b: &Color) -> bool {
    let a_str = match a {
        Color::Rgb(s) => s.as_str(),
        Color::Theme(_, _) | Color::None => return false,
    };
    let b_str = match b {
        Color::Rgb(s) => s.as_str(),
        Color::Theme(_, _) | Color::None => return false,
    };
    let (ar, ag, ab) = match parse_color(a_str) {
        Some(rgb) => rgb,
        None => return false,
    };
    let (br, bg, bb) = match parse_color(b_str) {
        Some(rgb) => rgb,
        None => return false,
    };
    let luminance_a = compute_luminance(ar, ag, ab);
    let luminance_b = compute_luminance(br, bg, bb);
    luminance_b < luminance_a
}

/// Is border b "heavier" than a?
pub(crate) fn is_max_border(a: Option<&BorderItem>, b: Option<&BorderItem>) -> bool {
    match (a, b) {
        (_, None) => false,
        (None, Some(_)) => true,
        (Some(item_a), Some(item_b)) => {
            if item_a.style < item_b.style {
                return true;
            } else if item_a.style > item_b.style {
                return false;
            }
            match (&item_a.color, &item_b.color) {
                (_, Color::None) => false,
                (Color::None, _) => true,
                (color_a, color_b) => is_max_color(color_a, color_b),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{BorderStyle, Color};

    fn rgb(s: &str) -> Color {
        Color::Rgb(s.to_string())
    }

    #[test]
    fn compare_borders() {
        let b = BorderItem {
            style: BorderStyle::Thin,
            color: Color::Rgb("#FFF".to_string()),
        };
        // Some border *always* beats no border
        assert!(is_max_border(None, Some(&b)));

        // No border is beaten by some border
        assert!(!is_max_border(Some(&b), None));
    }

    #[test]
    fn basic_colors() {
        // Black vs White
        assert!(is_max_color(&rgb("#FFFFFF"), &rgb("#000000")));
        assert!(!is_max_color(&rgb("#000000"), &rgb("#FFFFFF")));

        // Red vs Dark Red
        assert!(is_max_color(&rgb("#FF0000"), &rgb("#800000")));
        assert!(!is_max_color(&rgb("#800000"), &rgb("#FF0000")));

        // Green vs Dark Green
        assert!(is_max_color(&rgb("#00FF00"), &rgb("#008000")));
        assert!(!is_max_color(&rgb("#008000"), &rgb("#00FF00")));

        // Blue vs Dark Blue
        assert!(is_max_color(&rgb("#0000FF"), &rgb("#000080")));
        assert!(!is_max_color(&rgb("#000080"), &rgb("#0000FF")));
    }

    #[test]
    fn same_color() {
        assert!(!is_max_color(&rgb("#123456"), &rgb("#123456")));
    }

    #[test]
    fn edge_cases() {
        assert!(!is_max_color(&rgb("#000000"), &rgb("#010101")));
        assert!(!is_max_color(&rgb("#FEFEFE"), &rgb("#FFFFFF")));
        assert!(!is_max_color(&rgb("#7F7F7F"), &rgb("#808080")));
    }

    #[test]
    fn luminance_ordering() {
        assert!(is_max_color(&rgb("#CCCCCC"), &rgb("#333333")));
        assert!(is_max_color(&rgb("#FFFF00"), &rgb("#808000")));
        assert!(is_max_color(&rgb("#FF00FF"), &rgb("#800080")));
    }

    #[test]
    fn borderline_cases() {
        assert!(!is_max_color(&rgb("#777777"), &rgb("#777777")));
        assert!(!is_max_color(&rgb("#000000"), &rgb("#010000")));
    }
}
