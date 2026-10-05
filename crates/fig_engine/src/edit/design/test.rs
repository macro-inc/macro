use crate::document::{Document, NodeIdx};
use crate::edit::{History, Op};
use crate::inspect::{DesignInfo, design_info, local_styles};
use crate::model::{Guid, NodeType, PaintKind, PropValue, Props, StyleType};
use crate::save::save;
use crate::scene::Scene;
use crate::testing::design_system::{Builder, design_system_file};

struct Design {
    doc: Document,
    history: History,
    original: Vec<u8>,
}

impl Design {
    fn open(bytes: Vec<u8>) -> Design {
        Design {
            doc: Document::open(&bytes).unwrap(),
            history: History::default(),
            original: bytes,
        }
    }

    fn fixture() -> Design {
        Design::open(design_system_file())
    }

    fn apply(&mut self, json: &str) -> Vec<String> {
        let ops: Vec<Op> = serde_json::from_str(json).unwrap();
        self.history
            .apply(&mut self.doc, &ops, None)
            .unwrap()
            .created
    }

    fn try_apply(&mut self, json: &str) -> crate::Result<Vec<String>> {
        let ops: Vec<Op> = serde_json::from_str(json).unwrap();
        Ok(self.history.apply(&mut self.doc, &ops, None)?.created)
    }

    /// The id of the live layer named `name` with type `t`.
    fn id(&self, name: &str, t: NodeType) -> String {
        self.doc
            .nodes
            .iter()
            .find(|n| !n.removed && n.props.name() == name && n.props.node_type() == t)
            .and_then(|n| n.props.guid)
            .unwrap_or_else(|| panic!("no {t:?} named {name}"))
            .to_string()
    }

    fn idx(&self, id: &str) -> NodeIdx {
        self.doc.find(Guid::parse(id).unwrap()).unwrap()
    }

    fn props(&self, id: &str) -> &Props {
        self.doc.props(self.idx(id))
    }

    fn scene(&self, id: &str) -> Scene {
        let root = id.trim_start_matches('I').split(';').next().unwrap();
        let page = self.doc.page_of(self.idx(root)).unwrap();
        Scene::build(&self.doc, page)
    }

    fn info(&self, id: &str) -> DesignInfo {
        let scene = self.scene(id);
        let i = scene.find(&self.doc, id).unwrap();
        design_info(&self.doc, &scene, i)
    }

    /// What layer `id` (`I…` inside instances) shows.
    fn shown(&self, id: &str) -> Props {
        let scene = self.scene(id);
        let i = scene.find(&self.doc, id).unwrap();
        scene.props(&self.doc, i).clone()
    }

    /// Saves, reopens, and returns the reopened design.
    fn reopened(&self) -> Design {
        Design::open(save(&self.doc, &self.original).unwrap())
    }

    fn instances(&self) -> (String, String) {
        let screen = self.idx(&self.id("Screen", NodeType::Frame));
        let mut card = None;
        let mut button = None;
        for &c in &self.doc.node(screen).children {
            let p = self.doc.props(c);
            match p.name() {
                "Card" if p.node_type() == NodeType::Instance => card = p.guid,
                "Button" if p.node_type() == NodeType::Instance => button = p.guid,
                _ => {}
            }
        }
        (card.unwrap().to_string(), button.unwrap().to_string())
    }
}

fn chars(p: &Props) -> String {
    p.text_content
        .as_ref()
        .map(|t| t.characters.to_string())
        .unwrap_or_default()
}

fn property(info: &DesignInfo, name: &str) -> String {
    info.instance
        .as_ref()
        .unwrap()
        .own
        .properties
        .iter()
        .find(|p| p.name == name)
        .unwrap()
        .id
        .clone()
}

#[test]
fn variant_names_parse_and_format() {
    use super::variants::{parse_variant_name, variant_name};
    let pairs = parse_variant_name("Size=Large, State = Hover").unwrap();
    assert_eq!(
        pairs,
        vec![
            ("Size".to_owned(), "Large".to_owned()),
            ("State".to_owned(), "Hover".to_owned())
        ]
    );
    assert_eq!(variant_name(&pairs), "Size=Large, State=Hover");
    assert_eq!(parse_variant_name("Button/Primary"), None);
    assert_eq!(parse_variant_name("=x"), None);
}

#[test]
fn instances_show_their_properties_and_variants() {
    let d = Design::fixture();
    let (card, button) = d.instances();
    let info = d.info(&card);
    let inst = info.instance.as_ref().unwrap();
    assert_eq!(inst.main.as_ref().unwrap().name, "Card");
    assert_eq!(inst.main_page, Some(1));
    let names: Vec<&str> = inst
        .own
        .properties
        .iter()
        .map(|p| p.name.as_str())
        .collect();
    assert_eq!(names, ["Show icon", "Icon", "Title"]);
    assert_eq!(inst.own.properties[0].value.bool, Some(true));
    assert_eq!(
        inst.own.properties[1]
            .value
            .component
            .as_ref()
            .unwrap()
            .name,
        "Icon/Star"
    );
    assert_eq!(
        inst.own.properties[2].value.text.as_deref(),
        Some("Card title")
    );
    assert!(!inst.changed);

    let info = d.info(&button);
    let inst = info.instance.as_ref().unwrap();
    assert_eq!(inst.set.as_ref().unwrap().name, "Button");
    let variants: Vec<(&str, &str, Vec<&str>)> = inst
        .own
        .variants
        .iter()
        .map(|v| {
            (
                v.name.as_str(),
                v.value.as_str(),
                v.options.iter().map(String::as_str).collect(),
            )
        })
        .collect();
    assert_eq!(
        variants,
        [
            ("Type", "Primary", vec!["Primary", "Secondary"]),
            ("Size", "Medium", vec!["Medium"])
        ]
    );
    assert_eq!(inst.own.properties.len(), 1);
    assert_eq!(inst.own.properties[0].name, "Label");
}

#[test]
fn text_properties_lay_their_text_out_again_and_save() {
    let mut d = Design::fixture();
    let (card, _) = d.instances();
    let title_def = property(&d.info(&card), "Title");
    let title = d.id("Title", NodeType::Text);
    let before = d.shown(&format!("I{card};{title}"));
    d.apply(&format!(
        r#"[{{"op":"setProperty","ids":["{card}"],"property":"{title_def}","value":{{"text":"A much longer card title"}}}}]"#
    ));
    let after = d.shown(&format!("I{card};{title}"));
    assert_eq!(chars(&after), "A much longer card title");
    let glyphs = |p: &Props| p.text_layout.as_ref().map_or(0, |l| l.glyphs.len());
    assert!(
        glyphs(&after) > glyphs(&before),
        "the new text has its own glyphs"
    );
    let info = d.info(&card);
    let p = &info.instance.as_ref().unwrap().own.properties[2];
    assert!(p.changed);
    assert!(info.instance.as_ref().unwrap().changed);

    let r = d.reopened();
    assert_eq!(
        chars(&r.shown(&format!("I{card};{title}"))),
        "A much longer card title"
    );
    let assigned = r.props(&card).prop_assignments.clone().unwrap();
    assert!(
        matches!(&assigned[0].value, PropValue::Text(t) if t.as_ref() == "A much longer card title")
    );

    // Resetting the property brings the default back.
    d.apply(&format!(
        r#"[{{"op":"resetInstance","ids":["{card}"],"property":"{title_def}"}}]"#
    ));
    assert_eq!(chars(&d.shown(&format!("I{card};{title}"))), "Card title");
}

#[test]
fn boolean_and_instance_swap_properties() {
    let mut d = Design::fixture();
    let (card, _) = d.instances();
    let info = d.info(&card);
    let show = property(&info, "Show icon");
    let swap = property(&info, "Icon");
    let icon = d.id("Icon", NodeType::Instance);
    let heart = d.id("Icon/Heart", NodeType::Symbol);
    d.apply(&format!(
        r#"[{{"op":"setProperty","ids":["{card}"],"property":"{show}","value":{{"bool":false}}}}]"#
    ));
    assert!(!d.shown(&format!("I{card};{icon}")).visible());
    d.apply(&format!(
        r#"[{{"op":"setProperty","ids":["{card}"],"property":"{show}","value":{{"bool":true}}}},
            {{"op":"setProperty","ids":["{card}"],"property":"{swap}","value":{{"component":"{heart}"}}}}]"#
    ));
    let shown = d.shown(&format!("I{card};{icon}"));
    assert!(shown.visible());
    assert_eq!(
        shown.swapped_symbol.map(|g| g.to_string()),
        Some(heart.clone())
    );
    // The swapped icon draws the heart's shape.
    let scene = d.scene(&card);
    let i = scene.find(&d.doc, &format!("I{card};{icon}")).unwrap();
    let child = scene.node(i).children[0];
    let fill = &scene.props(&d.doc, child).fills()[0];
    assert!(matches!(fill.kind, PaintKind::Solid(c) if c.hex() == "E0245E"));
    let info = d.info(&card);
    assert_eq!(
        info.instance.as_ref().unwrap().own.properties[1]
            .value
            .component
            .as_ref()
            .unwrap()
            .name,
        "Icon/Heart"
    );
    // A text value of a non-text kind is refused by the property's layer
    // binding, but stored values survive saving.
    let r = d.reopened();
    assert_eq!(
        r.shown(&format!("I{card};{icon}"))
            .swapped_symbol
            .map(|g| g.to_string()),
        Some(heart)
    );
}

#[test]
fn switching_variants_keeps_overrides_that_apply() {
    let mut d = Design::fixture();
    let (_, button) = d.instances();
    let primary_label = {
        let set = d.idx(&d.id("Button", NodeType::Frame));
        let primary = d.doc.node(set).children[0];
        let label = d
            .doc
            .node(primary)
            .children
            .iter()
            .copied()
            .find(|&c| d.doc.props(c).name() == "Label")
            .unwrap();
        d.doc.props(label).guid.unwrap().to_string()
    };
    // An override of the label's fill (not bound to a property).
    d.apply(&format!(
        r#"[{{"op":"set","ids":["I{button};{primary_label}"],"props":{{"fills":[{{"color":"FF0000"}}]}}}}]"#
    ));
    d.apply(&format!(
        r#"[{{"op":"setProperty","ids":["{button}"],"property":"Type","value":{{"variant":"Secondary"}}}}]"#
    ));
    let info = d.info(&button);
    let inst = info.instance.as_ref().unwrap();
    assert_eq!(
        inst.main.as_ref().unwrap().name,
        "Type=Secondary, Size=Medium"
    );
    assert_eq!(inst.own.variants[0].value, "Secondary");
    // The override moved to the secondary variant's label.
    let set = d.idx(&d.id("Button", NodeType::Frame));
    let secondary = d.doc.node(set).children[1];
    let label = d
        .doc
        .node(secondary)
        .children
        .iter()
        .copied()
        .find(|&c| d.doc.props(c).name() == "Label")
        .unwrap();
    let label = d.doc.props(label).guid.unwrap();
    let shown = d.shown(&format!("I{button};{label}"));
    assert!(matches!(shown.fills()[0].kind, PaintKind::Solid(c) if c.hex() == "FF0000"));
    let r = d.reopened();
    assert!(matches!(
        r.shown(&format!("I{button};{label}")).fills()[0].kind,
        PaintKind::Solid(c) if c.hex() == "FF0000"
    ));
    // Undo goes back to the primary variant.
    d.history.undo(&mut d.doc);
    let info = d.info(&button);
    assert_eq!(info.instance.unwrap().own.variants[0].value, "Primary");
}

#[test]
fn swapping_and_resetting_instances() {
    let mut d = Design::fixture();
    let (card, _) = d.instances();
    let star = d.id("Icon/Star", NodeType::Symbol);
    let title_def = property(&d.info(&card), "Title");
    d.apply(&format!(
        r#"[{{"op":"setProperty","ids":["{card}"],"property":"{title_def}","value":{{"text":"Changed"}}}}]"#
    ));
    // A nested instance swapped directly (an override on the card).
    let icon = d.id("Icon", NodeType::Instance);
    let heart = d.id("Icon/Heart", NodeType::Symbol);
    d.apply(&format!(
        r#"[{{"op":"swapInstance","ids":["I{card};{icon}"],"component":"{heart}"}}]"#
    ));
    assert_eq!(
        d.shown(&format!("I{card};{icon}"))
            .swapped_symbol
            .map(|g| g.to_string()),
        Some(heart.clone())
    );
    d.apply(&format!(r#"[{{"op":"resetInstance","ids":["{card}"]}}]"#));
    assert!(!d.info(&card).instance.unwrap().changed);
    assert_eq!(
        d.shown(&format!("I{card};{icon}")).swapped_symbol,
        None,
        "the nested swap is reset"
    );
    // The card itself swapped to another component.
    d.apply(&format!(
        r#"[{{"op":"swapInstance","ids":["{card}"],"component":"{star}"}}]"#
    ));
    let p = d.props(&card);
    assert_eq!(
        p.symbol.as_ref().unwrap().symbol_id.map(|g| g.to_string()),
        Some(star.clone())
    );
    assert_eq!(
        p.size().x,
        24.0,
        "an instance not resized takes its new size"
    );
    let r = d.reopened();
    assert_eq!(
        r.props(&card)
            .symbol
            .as_ref()
            .unwrap()
            .symbol_id
            .map(|g| g.to_string()),
        Some(star)
    );
}

#[test]
fn combining_components_as_variants() {
    let mut b = Builder::new("Variants");
    let mut ids = Vec::new();
    for (k, name) in ["Chip/Small", "Chip/Large"].iter().enumerate() {
        let f = b.op(&format!(
            r#"[{{"op":"create","parent":"0:1","node":{{"type":"FRAME","name":"{name}","x":{},"y":0,"width":40,"height":20}}}}]"#,
            k * 60
        ))[0]
            .clone();
        b.op(&format!(r#"[{{"op":"createComponent","ids":["{f}"]}}]"#));
        ids.push(f);
    }
    let set = b.op(&format!(
        r#"[{{"op":"combineAsVariants","ids":["{}","{}"]}}]"#,
        ids[0], ids[1]
    ))[0]
        .clone();
    let d = Design {
        doc: b.doc,
        history: b.history,
        original: b.original,
    };
    let s = d.props(&set);
    assert_eq!(s.name(), "Chip");
    assert_eq!(s.is_state_group, Some(true));
    assert_eq!(d.props(&ids[0]).name(), "Property 1=Small");
    assert_eq!(d.props(&ids[1]).name(), "Property 1=Large");
    // The set pads its variants.
    let set_world = d.doc.world(d.idx(&set));
    let variant_world = d.doc.world(d.idx(&ids[0]));
    assert_eq!(variant_world.m02 - set_world.m02, 20.0);
    assert_eq!(d.doc.world(d.idx(&ids[1])).m02, 60.0, "variants stay put");
    let check = |d: &Design| {
        let s = d.props(&set);
        let defs = s.prop_defs.as_deref().unwrap();
        assert_eq!(defs.len(), 1);
        assert_eq!(
            (defs[0].name.as_str(), defs[0].kind.as_str()),
            ("Property 1", "VARIANT")
        );
        let orders = s.variant_orders.as_deref().unwrap();
        let values: Vec<&str> = orders[0].values.iter().map(|v| v.as_ref()).collect();
        assert_eq!(values, ["Small", "Large"]);
        let spec = &d.props(&ids[1]).variant_specs.as_deref().unwrap()[0];
        assert_eq!((spec.def_id, spec.value.as_ref()), (defs[0].id, "Large"));
    };
    check(&d);
    check(&d.reopened());
    let panel = d.info(&set).component.unwrap();
    assert!(panel.is_set);
    assert_eq!(panel.variant_properties[0].values, ["Small", "Large"]);
    assert_eq!(panel.variants.len(), 2);
}

#[test]
fn variant_properties_stay_in_step_with_names() {
    let mut d = Design::fixture();
    let set = d.id("Button", NodeType::Frame);
    let variants = d.doc.node(d.idx(&set)).children.clone();
    let first = d.doc.props(variants[0]).guid.unwrap().to_string();
    d.apply(&format!(
        r#"[{{"op":"renameVariantProperty","set":"{set}","from":"Size","to":"Scale"}},
            {{"op":"setVariantValue","ids":["{first}"],"property":"Scale","value":"Large"}}]"#
    ));
    assert_eq!(d.props(&first).name(), "Type=Primary, Scale=Large");
    let added = d.apply(&format!(r#"[{{"op":"addVariant","set":"{set}"}}]"#));
    assert_eq!(d.props(&added[0]).name(), "Type=Variant3, Scale=Medium");
    let check = |d: &Design| {
        let s = d.props(&set);
        let orders: Vec<(String, Vec<String>)> = s
            .variant_orders
            .as_deref()
            .unwrap()
            .iter()
            .map(|o| {
                (
                    o.property.to_string(),
                    o.values.iter().map(|v| v.to_string()).collect(),
                )
            })
            .collect();
        assert_eq!(
            orders,
            [
                (
                    "Type".to_owned(),
                    vec![
                        "Primary".to_owned(),
                        "Secondary".to_owned(),
                        "Variant3".to_owned()
                    ]
                ),
                (
                    "Scale".to_owned(),
                    vec!["Medium".to_owned(), "Large".to_owned()]
                )
            ]
        );
        let defs: Vec<&str> = s
            .prop_defs
            .as_deref()
            .unwrap()
            .iter()
            .map(|d| d.name.as_str())
            .collect();
        assert_eq!(defs, ["Type", "Scale", "Label"]);
    };
    check(&d);
    check(&d.reopened());
    // The new variant sits inside the set, below the others.
    let set_size = d.props(&set).size();
    let bounds = |id: &str| {
        let p = d.props(id);
        d.doc
            .world(d.idx(id))
            .map_rect(&crate::model::Rect::new(0.0, 0.0, p.size().x, p.size().y))
    };
    let new = bounds(&added[0]);
    let s = bounds(&set);
    assert!(new.y + new.h <= s.y + set_size.y);
    d.apply(&format!(
        r#"[{{"op":"removeVariantProperty","set":"{set}","name":"Scale"}}]"#
    ));
    assert_eq!(d.props(&first).name(), "Type=Primary");
    assert_eq!(d.props(&set).variant_orders.as_deref().unwrap().len(), 1);
}

#[test]
fn component_property_defaults_and_bindings() {
    let mut d = Design::fixture();
    let card = d.id("Card", NodeType::Symbol);
    let title = d.id("Title", NodeType::Text);
    let panel = d.info(&card).component.unwrap();
    let title_def = panel
        .properties
        .iter()
        .find(|p| p.name == "Title")
        .unwrap()
        .id
        .clone();
    assert_eq!(
        panel.properties.iter().map(|p| p.bound).collect::<Vec<_>>(),
        [1, 1, 1]
    );
    // A new default shows on the bound layer, and in instances.
    d.apply(&format!(
        r#"[{{"op":"editComponentProperty","component":"{card}","property":"{title_def}","name":"Heading","value":{{"text":"Hello"}}}}]"#
    ));
    assert_eq!(chars(d.props(&title)), "Hello");
    let (instance, _) = d.instances();
    assert_eq!(chars(&d.shown(&format!("I{instance};{title}"))), "Hello");
    let panel = d.info(&card).component.unwrap();
    assert_eq!(panel.properties[2].name, "Heading");
    // A layer's bindings.
    let layer = d.info(&title).layer.unwrap();
    assert_eq!(layer.fields[1].field, "TEXT");
    assert_eq!(
        layer.fields[1].property.as_deref(),
        Some(title_def.as_str())
    );
    // Deleting the property unbinds the layer.
    d.apply(&format!(
        r#"[{{"op":"deleteComponentProperty","component":"{card}","property":"{title_def}"}}]"#
    ));
    assert!(d.props(&title).prop_refs.as_deref().unwrap().is_empty());
    assert_eq!(d.info(&card).component.unwrap().properties.len(), 2);
    let r = d.reopened();
    assert_eq!(r.props(&card).prop_defs.as_deref().unwrap().len(), 2);
    assert!(r.props(&title).prop_refs.is_none());
    // Binding text to a boolean property is refused.
    let show = d.info(&card).component.unwrap().properties[0].id.clone();
    assert!(
        d.try_apply(&format!(
            r#"[{{"op":"bindProperty","ids":["{title}"],"field":"TEXT","property":"{show}"}}]"#
        ))
        .is_err()
    );
}

#[test]
fn a_variant_property_on_a_component_makes_a_set() {
    let mut d = Design::fixture();
    let star = d.id("Icon/Star", NodeType::Symbol);
    d.apply(&format!(
        r#"[{{"op":"addComponentProperty","component":"{star}","name":"Filled","kind":"VARIANT","value":{{"text":"Yes"}}}}]"#
    ));
    assert_eq!(d.props(&star).name(), "Filled=Yes");
    let set = d.doc.node(d.idx(&star)).parent.unwrap();
    assert_eq!(d.doc.props(set).is_state_group, Some(true));
    assert_eq!(d.doc.props(set).name(), "Icon/Star");
}

#[test]
fn styles_apply_edit_detach_and_delete() {
    let mut d = Design::fixture();
    let styles = local_styles(&d.doc);
    let names: Vec<(&str, StyleType)> = styles
        .iter()
        .map(|s| (s.name.as_str(), s.style_type))
        .collect();
    assert_eq!(
        names,
        [
            ("Brand/Primary", StyleType::Fill),
            ("Heading", StyleType::Text),
            ("Elevation/1", StyleType::Effect)
        ]
    );
    let brand = styles[0].id.clone();
    let swatch = d.id("Swatch", NodeType::Rectangle);
    assert_eq!(d.info(&swatch).styles.fill.unwrap().name, "Brand/Primary");
    // Another layer takes the style; editing it changes both.
    let card_bg = d.id("Background", NodeType::Rectangle);
    d.apply(&format!(
        r#"[{{"op":"applyStyle","ids":["{card_bg}"],"kind":"FILL","style":"{brand}"}},
            {{"op":"editStyle","style":"{brand}","name":"Brand/Accent","props":{{"fills":[{{"color":"00FF00"}}]}}}}]"#
    ));
    for id in [&swatch, &card_bg] {
        let p = d.props(id);
        assert!(matches!(p.fills()[0].kind, PaintKind::Solid(c) if c.hex() == "00FF00"));
        assert_eq!(p.fill_style.map(|g| g.to_string()), Some(brand.clone()));
    }
    // Instances of the card show it too.
    let (card, _) = d.instances();
    let shown = d.shown(&format!("I{card};{card_bg}"));
    assert!(matches!(shown.fills()[0].kind, PaintKind::Solid(c) if c.hex() == "00FF00"));
    let r = d.reopened();
    assert_eq!(
        r.props(&card_bg).fill_style.map(|g| g.to_string()),
        Some(brand.clone())
    );
    assert_eq!(local_styles(&r.doc)[0].name, "Brand/Accent");
    // Detaching keeps the color and drops the reference, also when saved.
    d.apply(&format!(
        r#"[{{"op":"applyStyle","ids":["{swatch}"],"kind":"FILL"}}]"#
    ));
    assert_eq!(d.props(&swatch).fill_style, None);
    assert!(matches!(d.props(&swatch).fills()[0].kind, PaintKind::Solid(c) if c.hex() == "00FF00"));
    assert_eq!(d.reopened().props(&swatch).fill_style, None);
    // A fill typed in directly detaches too.
    d.apply(&format!(
        r#"[{{"op":"set","ids":["{card_bg}"],"props":{{"fills":[{{"color":"123456"}}]}}}}]"#
    ));
    assert_eq!(d.reopened().props(&card_bg).fill_style, None);
    // Deleted styles leave the list.
    d.apply(&format!(r#"[{{"op":"deleteStyle","ids":["{brand}"]}}]"#));
    assert_eq!(local_styles(&d.reopened().doc).len(), 2);
}

#[test]
fn text_and_effect_styles() {
    let mut d = Design::fixture();
    let styles = local_styles(&d.doc);
    let heading = styles.iter().find(|s| s.name == "Heading").unwrap();
    assert_eq!(heading.text.as_ref().unwrap().font_size, Some(24.0));
    let heading = heading.id.clone();
    let elevation = styles
        .iter()
        .find(|s| s.name == "Elevation/1")
        .unwrap()
        .id
        .clone();
    let title = d.id("Title", NodeType::Text);
    d.apply(&format!(
        r#"[{{"op":"applyStyle","ids":["{title}"],"kind":"TEXT","style":"{heading}"}}]"#
    ));
    let p = d.props(&title);
    assert_eq!(p.text_style.as_ref().unwrap().font_size, Some(24.0));
    assert_eq!(
        p.text_style_id.map(|g| g.to_string()),
        Some(heading.clone())
    );
    assert_eq!(d.info(&title).styles.text.unwrap().name, "Heading");
    // Editing the style's size relays every text using it.
    d.apply(&format!(
        r#"[{{"op":"editStyle","style":"{heading}","props":{{"fontSize":30}}}}]"#
    ));
    assert_eq!(
        d.props(&title).text_style.as_ref().unwrap().font_size,
        Some(30.0)
    );
    assert_eq!(
        d.props(&title).text_style_id.map(|g| g.to_string()),
        Some(heading.clone())
    );
    let r = d.reopened();
    assert_eq!(
        r.props(&title).text_style_id.map(|g| g.to_string()),
        Some(heading.clone())
    );
    // Changing the size by hand detaches it, as in Figma.
    d.apply(&format!(
        r#"[{{"op":"set","ids":["{title}"],"props":{{"fontSize":12}}}}]"#
    ));
    assert_eq!(d.props(&title).text_style_id, None);
    // Effects.
    let card_bg = d.id("Background", NodeType::Rectangle);
    d.apply(&format!(
        r#"[{{"op":"applyStyle","ids":["{card_bg}"],"kind":"EFFECT","style":"{elevation}"}}]"#
    ));
    assert_eq!(d.props(&card_bg).effects().len(), 1);
    // A layer inside an instance takes a style as an override.
    let (card, _) = d.instances();
    let brand = styles[0].id.clone();
    d.apply(&format!(
        r#"[{{"op":"applyStyle","ids":["I{card};{card_bg}"],"kind":"FILL","style":"{brand}"}}]"#
    ));
    let shown = d.shown(&format!("I{card};{card_bg}"));
    assert_eq!(shown.fill_style.map(|g| g.to_string()), Some(brand.clone()));
    assert_eq!(
        d.reopened()
            .shown(&format!("I{card};{card_bg}"))
            .fill_style
            .map(|g| g.to_string()),
        Some(brand)
    );
    // Styles only style what they are for.
    assert!(
        d.try_apply(&format!(
            r#"[{{"op":"applyStyle","ids":["{card_bg}"],"kind":"FILL","style":"{heading}"}}]"#
        ))
        .is_err()
    );
}

#[test]
fn styles_in_a_new_design_make_an_internal_canvas() {
    let mut b = Builder::new("New");
    let r = b.op(r#"[{"op":"create","parent":"0:1","node":{"type":"RECTANGLE","name":"R","x":0,"y":0,"width":10,"height":10,"props":{"fills":[{"color":"FF8800"}]}}}]"#)[0].clone();
    b.op(&format!(
        r#"[{{"op":"createStyle","kind":"STROKE","name":"Orange","from":"{r}"}}]"#
    ));
    let d = Design {
        doc: b.doc,
        history: b.history,
        original: b.original,
    };
    // A stroke style is a color style made from the strokes (none here).
    let styles = local_styles(&d.doc);
    assert_eq!(styles.len(), 1);
    assert_eq!(styles[0].style_type, StyleType::Fill);
    assert_eq!(d.doc.pages.len(), 1, "the internal canvas is not a page");
    let r2 = d.reopened();
    assert_eq!(r2.doc.pages.len(), 1);
    assert_eq!(local_styles(&r2.doc)[0].name, "Orange");
    assert_eq!(
        r2.props(&r).stroke_style.map(|g| g.to_string()),
        Some(styles[0].id.clone())
    );
}

/// A file shaped like Figma's newer ones: property definitions, values, and
/// bindings carry variable data (`varValue`) beside their values.
fn figma_shaped_file() -> Vec<u8> {
    use crate::kiwi::{Schema, schema_from_text};
    use crate::testing::{V, color, encode, guid, node, size, solid, translate};
    let text = crate::save::MACRO_SCHEMA
        .replace(
            "message ComponentPropAssignment defID:GUID value:ComponentPropValue",
            "enum VariableDataType BOOLEAN FLOAT STRING ALIAS COLOR EXPRESSION MAP SYMBOL_ID FONT_STYLE TEXT_DATA\nmessage SymbolId guid:GUID assetRef:AssetRef\nmessage VariableAnyValue boolValue:bool textValue:string symbolIdValue:SymbolId textDataValue:TextData\nmessage VariableData value:VariableAnyValue dataType:VariableDataType resolvedDataType:VariableDataType\nmessage ComponentPropAssignment defID:GUID value:ComponentPropValue varValue:VariableData",
        )
        .replace(
            "type:ComponentPropType isDeleted:bool preferredValues:ComponentPropPreferredValues",
            "type:ComponentPropType isDeleted:bool preferredValues:ComponentPropPreferredValues varValue:VariableData",
        );
    let schema_bytes = schema_from_text(&text);
    let schema = Schema::decode(&schema_bytes).unwrap();
    let bool_var = |b: bool| {
        V::Msg(vec![
            ("value", V::Msg(vec![("boolValue", V::Bool(b))])),
            ("dataType", V::Enum("BOOLEAN")),
            ("resolvedDataType", V::Enum("BOOLEAN")),
        ])
    };
    let nodes = vec![
        node(0, None, "DOCUMENT", "Document", vec![]),
        node(
            1,
            Some((0, "!")),
            "CANVAS",
            "Page",
            vec![("backgroundColor", color(1.0, 1.0, 1.0, 1.0))],
        ),
        node(
            10,
            Some((1, "!")),
            "SYMBOL",
            "Badge",
            vec![
                ("size", size(40.0, 20.0)),
                ("transform", translate(0.0, 0.0)),
                (
                    "componentPropDefs",
                    V::List(vec![V::Msg(vec![
                        ("id", guid(100)),
                        ("name", V::Str("Dot".into())),
                        ("type", V::Enum("BOOL")),
                        ("sortPosition", V::Str("a".into())),
                        ("initialValue", V::Msg(vec![("boolValue", V::Bool(true))])),
                        ("varValue", bool_var(true)),
                    ])]),
                ),
            ],
        ),
        node(
            11,
            Some((10, "!")),
            "ELLIPSE",
            "Dot",
            vec![
                ("size", size(8.0, 8.0)),
                ("transform", translate(2.0, 2.0)),
                ("fillPaints", V::List(vec![solid(1.0, 0.0, 0.0)])),
                (
                    "componentPropRefs",
                    V::List(vec![V::Msg(vec![
                        ("defID", guid(100)),
                        ("componentPropNodeField", V::Enum("VISIBLE")),
                    ])]),
                ),
            ],
        ),
        node(
            20,
            Some((1, "\"")),
            "INSTANCE",
            "Badge",
            vec![
                ("size", size(40.0, 20.0)),
                ("transform", translate(100.0, 0.0)),
                ("symbolData", V::Msg(vec![("symbolID", guid(10))])),
                (
                    "componentPropAssignments",
                    V::List(vec![V::Msg(vec![
                        ("defID", guid(100)),
                        ("value", V::Msg(vec![("boolValue", V::Bool(true))])),
                        ("varValue", bool_var(true)),
                    ])]),
                ),
            ],
        ),
    ];
    let message = encode(
        &schema,
        "Message",
        &[("nodeChanges", V::List(nodes)), ("blobs", V::List(vec![]))],
    );
    let mut out = b"fig-kiwi".to_vec();
    out.extend_from_slice(&48u32.to_le_bytes());
    for chunk in [schema_bytes, message] {
        let compressed = miniz_oxide::deflate::compress_to_vec(&chunk, 6);
        out.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        out.extend_from_slice(&compressed);
    }
    out
}

/// The saved record of node `local` (session 1), field by field.
fn saved_record(bytes: &[u8], local: u32) -> serde_json::Value {
    use crate::kiwi::{Decoder, Msg, Reader, Schema, Value};
    fn json(schema: &Schema, v: &Value) -> serde_json::Value {
        match v {
            Value::Bool(b) => (*b).into(),
            Value::Uint(u) => (*u).into(),
            Value::Str(s) => s.as_ref().into(),
            Value::Enum(d, f) => schema.enum_name(*d, *f).unwrap_or("?").into(),
            Value::Msg(m) => msg(schema, m),
            Value::List(l) => l.iter().map(|x| json(schema, x)).collect(),
            _ => serde_json::Value::Null,
        }
    }
    fn msg(schema: &Schema, m: &Msg) -> serde_json::Value {
        let def = schema.def(m.def);
        m.fields
            .iter()
            .map(|(i, v)| (def.fields[*i as usize].name.clone(), json(schema, v)))
            .collect::<serde_json::Map<_, _>>()
            .into()
    }
    let c = crate::container::Container::open(bytes).unwrap();
    let schema = Schema::decode(&c.schema).unwrap();
    let message = Decoder::new(&schema)
        .decode(
            &mut Reader::new(&c.message),
            schema.def_index("Message").unwrap(),
        )
        .unwrap();
    let Some(Value::List(nodes)) = message.get(&schema, "nodeChanges") else {
        panic!("no nodes")
    };
    nodes
        .iter()
        .filter_map(|n| match n {
            Value::Msg(m) => Some(msg(&schema, m)),
            _ => None,
        })
        .find(|n| n["guid"]["localID"] == local && n["guid"]["sessionID"] == 1)
        .unwrap()
}

#[test]
fn saving_keeps_figma_variable_values_in_step() {
    let mut d = Design::open(figma_shaped_file());
    d.apply(r#"[{"op":"setProperty","ids":["1:20"],"property":"1:100","value":{"bool":false}}]"#);
    assert!(!d.shown("I1:20;1:11").visible());
    let saved = save(&d.doc, &d.original).unwrap();
    let a = &saved_record(&saved, 20)["componentPropAssignments"][0];
    assert_eq!(a["value"]["boolValue"], false);
    assert_eq!(a["varValue"]["value"]["boolValue"], false);
    assert_eq!(a["varValue"]["dataType"], "BOOLEAN");
    // A new default rewrites the definition in place: its sort position
    // stays, the variable data follows.
    d.apply(r#"[{"op":"editComponentProperty","component":"1:10","property":"1:100","value":{"bool":false}}]"#);
    let saved = save(&d.doc, &d.original).unwrap();
    let def = &saved_record(&saved, 10)["componentPropDefs"][0];
    assert_eq!(def["sortPosition"], "a");
    assert_eq!(def["initialValue"]["boolValue"], false);
    assert_eq!(def["varValue"]["value"]["boolValue"], false);
    assert_eq!(saved_record(&saved, 11)["visible"], false);
    // Text values carry text data.
    d.apply(r#"[{"op":"addComponentProperty","component":"1:10","name":"Label","kind":"TEXT","value":{"text":"New"}}]"#);
    let saved = save(&d.doc, &d.original).unwrap();
    let defs = &saved_record(&saved, 10)["componentPropDefs"];
    assert_eq!(defs[1]["name"], "Label");
    assert_eq!(defs[1]["initialValue"]["textValue"]["characters"], "New");
    assert!(defs[1]["sortPosition"].as_str().unwrap() > "a");
}
