//! The SmartArt layouts, color variations, and styles this engine knows by
//! name, with PowerPoint's display names and gallery categories.

/// Prefix of PowerPoint's built-in layout ids.
pub(crate) const LAYOUT_PREFIX: &str = "urn:microsoft.com/office/officeart/2005/8/layout/";
/// Prefix of PowerPoint's built-in color variation ids.
pub(crate) const COLORS_PREFIX: &str = "urn:microsoft.com/office/officeart/2005/8/colors/";
/// Prefix of PowerPoint's built-in SmartArt style ids.
pub(crate) const STYLE_PREFIX: &str = "urn:microsoft.com/office/officeart/2005/8/quickstyle/";

/// PowerPoint's default color variation (Colored Fill - Accent 1).
pub(crate) const DEFAULT_COLORS: &str = "accent1_2";
/// PowerPoint's default SmartArt style (Simple Fill).
pub(crate) const DEFAULT_STYLE: &str = "simple1";

/// The layouts the engine lays out itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub(crate) enum Kind {
    /// Basic Block List.
    BlockList,
    /// Vertical Bullet List.
    VerticalBullets,
    /// Horizontal Bullet List.
    HorizontalBullets,
    /// Basic Process.
    Process,
    /// Basic Chevron Process.
    Chevron,
    /// Basic Cycle.
    Cycle,
    /// Basic Radial.
    Radial,
    /// Hierarchy.
    Hierarchy,
    /// Organization Chart.
    OrgChart,
    /// Basic Venn.
    Venn,
    /// Basic Pyramid.
    Pyramid,
}

/// A layout PowerPoint offers.
#[derive(Clone, Copy, Debug)]
pub(crate) struct LayoutInfo {
    /// The last part of the layout id (`process1`).
    pub short: &'static str,
    /// Display name.
    pub name: &'static str,
    /// Gallery categories (the first is the main one).
    pub categories: &'static [&'static str],
    /// The engine's own layout, when it lays this one out.
    pub kind: Option<Kind>,
}

impl LayoutInfo {
    /// The full layout id.
    pub fn id(&self) -> String {
        format!("{LAYOUT_PREFIX}{}", self.short)
    }
}

/// Layouts by name; the supported ones come first, in gallery order.
pub(crate) const LAYOUTS: &[LayoutInfo] = &[
    LayoutInfo {
        short: "default",
        name: "Basic Block List",
        categories: &["list"],
        kind: Some(Kind::BlockList),
    },
    LayoutInfo {
        short: "vList2",
        name: "Vertical Bullet List",
        categories: &["list"],
        kind: Some(Kind::VerticalBullets),
    },
    LayoutInfo {
        short: "hList1",
        name: "Horizontal Bullet List",
        categories: &["list"],
        kind: Some(Kind::HorizontalBullets),
    },
    LayoutInfo {
        short: "process1",
        name: "Basic Process",
        categories: &["process"],
        kind: Some(Kind::Process),
    },
    LayoutInfo {
        short: "chevron1",
        name: "Basic Chevron Process",
        categories: &["process"],
        kind: Some(Kind::Chevron),
    },
    LayoutInfo {
        short: "cycle2",
        name: "Basic Cycle",
        categories: &["cycle"],
        kind: Some(Kind::Cycle),
    },
    LayoutInfo {
        short: "radial1",
        name: "Basic Radial",
        categories: &["cycle", "relationship"],
        kind: Some(Kind::Radial),
    },
    LayoutInfo {
        short: "hierarchy1",
        name: "Hierarchy",
        categories: &["hierarchy"],
        kind: Some(Kind::Hierarchy),
    },
    LayoutInfo {
        short: "orgChart1",
        name: "Organization Chart",
        categories: &["hierarchy"],
        kind: Some(Kind::OrgChart),
    },
    LayoutInfo {
        short: "venn1",
        name: "Basic Venn",
        categories: &["relationship"],
        kind: Some(Kind::Venn),
    },
    LayoutInfo {
        short: "pyramid1",
        name: "Basic Pyramid",
        categories: &["pyramid"],
        kind: Some(Kind::Pyramid),
    },
    // Layouts other decks use, named for the outline.
    LayoutInfo {
        short: "list1",
        name: "Stacked List",
        categories: &["list"],
        kind: None,
    },
    LayoutInfo {
        short: "vList6",
        name: "Vertical Arrow List",
        categories: &["list"],
        kind: None,
    },
    LayoutInfo {
        short: "hList6",
        name: "Horizontal Bullet List",
        categories: &["list"],
        kind: None,
    },
    LayoutInfo {
        short: "chevron2",
        name: "Vertical Chevron List",
        categories: &["list", "process"],
        kind: None,
    },
    LayoutInfo {
        short: "hierarchy4",
        name: "Table Hierarchy",
        categories: &["hierarchy"],
        kind: None,
    },
    LayoutInfo {
        short: "hProcess9",
        name: "Continuous Block Process",
        categories: &["process"],
        kind: None,
    },
    LayoutInfo {
        short: "cycle1",
        name: "Text Cycle",
        categories: &["cycle"],
        kind: None,
    },
    LayoutInfo {
        short: "arrow2",
        name: "Upward Arrow",
        categories: &["process"],
        kind: None,
    },
    LayoutInfo {
        short: "pyramid2",
        name: "Pyramid List",
        categories: &["pyramid"],
        kind: None,
    },
    LayoutInfo {
        short: "matrix1",
        name: "Titled Matrix",
        categories: &["matrix"],
        kind: None,
    },
];

/// The layouts the engine can lay out, in gallery order.
pub(crate) fn supported_layouts() -> impl Iterator<Item = &'static LayoutInfo> {
    LAYOUTS.iter().filter(|l| l.kind.is_some())
}

/// Finds a layout by id (`urn:…/layout/process1`), short id (`process1`),
/// or display name (`Basic Process`), ignoring case.
pub(crate) fn find_layout(key: &str) -> Option<&'static LayoutInfo> {
    let key = key.trim();
    let short = key.rsplit('/').next().unwrap_or(key);
    LAYOUTS
        .iter()
        .find(|l| l.short.eq_ignore_ascii_case(short))
        .or_else(|| LAYOUTS.iter().find(|l| l.name.eq_ignore_ascii_case(key)))
}

/// The display name of a layout id, or a readable form of the id.
pub(crate) fn layout_name(id: &str, title: Option<&str>) -> String {
    if let Some(t) = title.filter(|t| !t.trim().is_empty()) {
        return t.trim().to_owned();
    }
    let short = id.rsplit('/').next().unwrap_or(id);
    match LAYOUTS.iter().find(|l| l.short == short) {
        Some(l) => l.name.to_owned(),
        None => short.to_owned(),
    }
}

/// A color variation (Change Colors).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ColorsInfo {
    /// The last part of the id (`accent1_2`).
    pub short: String,
    /// Display name (`Colored Fill - Accent 1`).
    pub name: String,
    /// Gallery group (`mainScheme`, `colorful`, `accent1`…).
    pub category: String,
}

impl ColorsInfo {
    /// The full id.
    pub fn id(&self) -> String {
        format!("{COLORS_PREFIX}{}", self.short)
    }
}

/// Every color variation in gallery order.
pub(crate) fn color_variations() -> Vec<ColorsInfo> {
    let mut out = Vec::new();
    let item = |short: String, name: String, category: &str| ColorsInfo {
        short,
        name,
        category: category.to_owned(),
    };
    for (k, name) in [
        (1, "Dark 1 Outline"),
        (2, "Dark 2 Outline"),
        (3, "Dark 2 Fill"),
    ] {
        out.push(item(format!("accent0_{k}"), name.to_owned(), "mainScheme"));
    }
    out.push(item(
        "colorful1".into(),
        "Colorful - Accent Colors".into(),
        "colorful",
    ));
    for n in 2..=5 {
        out.push(item(
            format!("colorful{n}"),
            format!("Colorful Range - Accent Colors {n} to {}", n + 1),
            "colorful",
        ));
    }
    for a in 1..=6 {
        for (k, name) in [
            (1, "Colored Outline"),
            (2, "Colored Fill"),
            (3, "Gradient Range"),
            (4, "Gradient Loop"),
            (5, "Transparent Gradient Range"),
        ] {
            out.push(item(
                format!("accent{a}_{k}"),
                format!("{name} - Accent {a}"),
                &format!("accent{a}"),
            ));
        }
    }
    out
}

/// Finds a color variation by id, short id, or display name.
pub(crate) fn find_colors(key: &str) -> Option<ColorsInfo> {
    let key = key.trim();
    let short = key.rsplit('/').next().unwrap_or(key);
    let all = color_variations();
    all.iter()
        .find(|c| c.short.eq_ignore_ascii_case(short))
        .or_else(|| all.iter().find(|c| c.name.eq_ignore_ascii_case(key)))
        .cloned()
}

/// A SmartArt style (quick style).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct StyleInfo {
    /// The last part of the id (`simple1`).
    pub short: &'static str,
    /// Display name.
    pub name: &'static str,
}

impl StyleInfo {
    /// The full id.
    pub fn id(&self) -> String {
        format!("{STYLE_PREFIX}{}", self.short)
    }
}

/// The SmartArt styles, in gallery order.
pub(crate) const STYLES: &[StyleInfo] = &[
    StyleInfo {
        short: "simple1",
        name: "Simple Fill",
    },
    StyleInfo {
        short: "simple2",
        name: "White Outline",
    },
    StyleInfo {
        short: "simple3",
        name: "Subtle Effect",
    },
    StyleInfo {
        short: "simple4",
        name: "Moderate Effect",
    },
    StyleInfo {
        short: "simple5",
        name: "Intense Effect",
    },
];

/// Finds a style by id, short id, or display name.
pub(crate) fn find_style(key: &str) -> Option<&'static StyleInfo> {
    let key = key.trim();
    let short = key.rsplit('/').next().unwrap_or(key);
    STYLES
        .iter()
        .find(|s| s.short.eq_ignore_ascii_case(short))
        .or_else(|| STYLES.iter().find(|s| s.name.eq_ignore_ascii_case(key)))
}
