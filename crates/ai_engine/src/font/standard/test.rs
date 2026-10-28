use super::*;

#[test]
fn standard_widths() {
    let helvetica = Standard::from_name("Helvetica").unwrap();
    assert_eq!(helvetica.width("A"), Some(667.0));
    assert_eq!(helvetica.width("space"), Some(278.0));
    assert_eq!(helvetica.width("nosuchglyph"), None);
    let times = Standard::from_name("Times-Roman").unwrap();
    assert_eq!(times.width("a"), Some(444.0));
    let bold = Standard::from_name("Helvetica-Bold").unwrap();
    assert_eq!(bold.width("A"), Some(722.0));
    // Obliques share the upright widths.
    let oblique = Standard::from_name("Helvetica-BoldOblique").unwrap();
    assert_eq!(oblique.width("A"), Some(722.0));
    for name in ["A", "a", "space", "Euro", "zcaron"] {
        assert_eq!(
            Standard::from_name("Courier").unwrap().width(name),
            Some(600.0)
        );
    }
    let symbol = Standard::from_name("Symbol").unwrap();
    assert_eq!(symbol.width("alpha"), Some(631.0));
    assert!(symbol.symbolic());
    assert_eq!(symbol.encoding(), BaseEncoding::Symbol);
    let dingbats = Standard::from_name("ZapfDingbats").unwrap();
    assert_eq!(dingbats.width("a1"), Some(974.0));
    assert!(dingbats.dingbats());
}

#[test]
fn standard_names_and_aliases() {
    let name = |n: &str| Standard::from_name(n).map(Standard::name);
    assert_eq!(name("ABCDEF+Arial,Bold"), Some("Helvetica-Bold"));
    assert_eq!(name("ArialMT"), Some("Helvetica"));
    assert_eq!(name("Arial-BoldItalicMT"), Some("Helvetica-BoldOblique"));
    assert_eq!(name("TimesNewRomanPSMT"), Some("Times-Roman"));
    assert_eq!(
        name("TimesNewRomanPS-BoldItalicMT"),
        Some("Times-BoldItalic")
    );
    assert_eq!(name("Times New Roman,Italic"), Some("Times-Italic"));
    assert_eq!(name("CourierNewPS-BoldMT"), Some("Courier-Bold"));
    assert_eq!(name("Courier-Oblique"), Some("Courier-Oblique"));
    assert_eq!(name("Symbol"), Some("Symbol"));
    // Other weights and families are not standard.
    assert_eq!(name("Arial-Black"), None);
    assert_eq!(name("Helvetica-Light"), None);
    assert_eq!(name("MyriadPro-Regular"), None);
}

#[test]
fn reads_font_names() {
    let n = FontName::parse("ABCDEF+MyriadPro-SemiboldIt");
    assert_eq!(n.family, "MyriadPro");
    assert_eq!(n.spaced_family(), "Myriad Pro");
    assert_eq!((n.weight, n.italic), (600.0, true));
    assert_eq!(n.style(), "Semi Bold Italic");

    let n = FontName::parse("Arial,BoldItalic");
    assert_eq!(
        (n.family.as_str(), n.weight, n.italic),
        ("Arial", 700.0, true)
    );
    let n = FontName::parse("NimbusRomNo9L-MediItal");
    assert_eq!(
        (n.family.as_str(), n.weight, n.italic),
        ("NimbusRomNo9L", 700.0, true)
    );
    let n = FontName::parse("Loma Regular");
    assert_eq!((n.family.as_str(), n.weight), ("Loma", 400.0));
    let n = FontName::parse("DejaVuSans-ExtraLight");
    assert_eq!(
        (n.spaced_family().as_str(), n.weight),
        ("Deja Vu Sans", 200.0)
    );
    let n = FontName::parse("TimesNewRoman");
    assert_eq!((n.family.as_str(), n.styled), ("TimesNewRoman", false));
    assert_eq!(strip_subset("ABCDEF+Name"), "Name");
    assert_eq!(strip_subset("ABCDEf+Name"), "ABCDEf+Name");
    assert_eq!(strip_subset("AB+Name"), "AB+Name");
}

#[test]
fn stand_ins_for_unembedded_fonts() {
    let (families, style) = stand_ins("Helvetica-BoldOblique", 0, 0.0);
    assert!(families.contains(&"Arimo".to_string()), "{families:?}");
    assert_eq!(style, "Bold Italic");
    let (families, _) = stand_ins("TimesNewRomanPSMT", 0, 0.0);
    assert_eq!(families.last().map(String::as_str), Some("Tinos"));
    let (families, _) = stand_ins("CourierNew", 0, 0.0);
    assert!(families.contains(&"Cousine".to_string()));
    let (families, _) = stand_ins("Calibri", 0, 0.0);
    assert!(families.contains(&"Carlito".to_string()));
    // Unknown families: their own names, then a serif look-alike by flags.
    let (families, style) = stand_ins("ABCDEF+Garamond", SERIF | ITALIC, -12.0);
    assert_eq!(families, ["Garamond", "Tinos"]);
    assert_eq!(style, "Italic");
    let (families, style) = stand_ins("SomeSans", FORCE_BOLD, 0.0);
    assert_eq!(families, ["SomeSans", "Some Sans"]);
    assert_eq!(style, "Bold");
}
