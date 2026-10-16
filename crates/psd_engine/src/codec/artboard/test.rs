use super::*;

fn block(rect: [f64; 4], background: i32, color: Option<Rgb>) -> Vec<u8> {
    let [top, left, bottom, right] = rect;
    let mut d = Descriptor::new("artboard")
        .with(
            "artboardRect",
            Value::Descriptor(
                Descriptor::new("classFloatRect")
                    .with("Top ", Value::Double(top))
                    .with("Left", Value::Double(left))
                    .with("Btom", Value::Double(bottom))
                    .with("Rght", Value::Double(right)),
            ),
        )
        .with("guideIndeces", Value::List(vec![Value::Integer(3)]))
        .with("artboardPresetName", Value::Text("iPhone".into()))
        .with("Clr ", Value::Bool(false))
        .with("artboardBackgroundType", Value::Integer(background));
    paint::put_color(&mut d, "Clr ", color.unwrap_or(Rgb::WHITE));
    descriptor::write_versioned(&d)
}

#[test]
fn reads_rectangles_and_backgrounds() {
    let a = decode(&block([0.0, 1182.0, 722.0, 2264.0], 3, None)).expect("decodes");
    assert_eq!(a.rect, IRect::new(1182, 0, 1082, 722));
    assert_eq!(a.background, ArtboardBackground::Transparent);
    let red = Rgb::from_u8(217, 117, 117);
    let a = decode(&block([799.0, 279.0, 1257.0, 877.0], 4, Some(red))).expect("decodes");
    let ArtboardBackground::Color { color } = a.background else {
        panic!("a color: {:?}", a.background)
    };
    assert_eq!(color.to_u8(), [217, 117, 117]);
    assert_eq!(
        decode(&block([0.0; 4], 1, None))
            .expect("decodes")
            .background,
        ArtboardBackground::White
    );
}

#[test]
fn writes_back_keeping_what_the_model_leaves_alone() {
    let original = block([0.0, 0.0, 100.0, 200.0], 1, None);
    let mut a = decode(&original).expect("decodes");
    assert_eq!(encode(&a, Some(&original)), original, "unchanged");

    a.rect = a.rect.translate(10, 20);
    a.background = ArtboardBackground::Black;
    let changed = encode(&a, Some(&original));
    assert_eq!(decode(&changed).expect("decodes"), a);
    let (d, _) = descriptor::read_versioned(&changed).expect("reads");
    assert_eq!(d.text("artboardPresetName"), Some("iPhone"));
    assert_eq!(d.list("guideIndeces").map(<[Value]>::len), Some(1));

    let new = Artboard {
        rect: IRect::new(5, 6, 7, 8),
        background: ArtboardBackground::Color {
            color: Rgb::from_u8(1, 2, 3),
        },
    };
    assert_eq!(decode(&encode(&new, None)).expect("decodes"), new);
}
