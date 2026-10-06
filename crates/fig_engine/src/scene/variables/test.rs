use super::*;
use crate::model::Color;
use crate::testing::design_system::variables_file_with_remote;

#[test]
fn remote_variables_follow_inherited_modes_in_eager_and_lazy_scenes() {
    let bytes = Arc::new(variables_file_with_remote(true));
    for doc in [
        Document::open(&bytes).unwrap(),
        Document::open_lazy(&bytes).unwrap(),
    ] {
        let scene = Scene::build(&doc, doc.pages[0]);
        // The screen inherits Dark; Brand aliases Surface in this mode.
        // The component instance must inherit the screen's mode as well.
        for id in ["1:10", "1:11", "I1:30;1:21"] {
            let i = scene.find(&doc, id).unwrap();
            assert_eq!(
                scene.props(&doc, i).fills()[0].kind,
                PaintKind::Solid(Color::BLACK),
                "{id}"
            );
        }
        // The original component, outside the screen, uses the default Light.
        let i = scene.find(&doc, "1:21").unwrap();
        assert_eq!(
            scene.props(&doc, i).fills()[0].kind,
            PaintKind::Solid(Color::WHITE)
        );
        // Rendering must not rewrite the original fallback color in the file.
        let frame = doc.find(Guid::parse("1:10").unwrap()).unwrap();
        assert_eq!(
            doc.props(frame).fills()[0].kind,
            PaintKind::Solid(Color::WHITE)
        );
        let isolated = Scene::build_instance(&doc, doc.find(Guid::parse("1:30").unwrap()).unwrap());
        let i = isolated.find(&doc, "I1:30;1:21").unwrap();
        assert_eq!(
            isolated.props(&doc, i).fills()[0].kind,
            PaintKind::Solid(Color::BLACK)
        );
    }
}

#[test]
fn missing_and_cyclic_variables_keep_the_stored_color() {
    let bytes = variables_file_with_remote(true);
    let mut doc = Document::open(&bytes).unwrap();
    let surface = doc.find(Guid::parse("1:51").unwrap()).unwrap();
    let original = doc.nodes[surface as usize].props.variable.clone();
    doc.nodes[surface as usize].props.variable = None;
    let scene = Scene::build(&doc, doc.pages[0]);
    let frame = scene.find(&doc, "1:10").unwrap();
    assert_eq!(
        scene.props(&doc, frame).fills()[0].kind,
        PaintKind::Solid(Color::WHITE)
    );
    let mut variable = (*original.unwrap()).clone();
    variable.values = Arc::from([(
        Guid::parse("1:61").unwrap(),
        VariableValue::Alias(Guid::parse("1:51").unwrap()),
    )]);
    doc.nodes[surface as usize].props.variable = Some(Arc::new(variable));
    let scene = Scene::build(&doc, doc.pages[0]);
    let frame = scene.find(&doc, "1:10").unwrap();
    assert_eq!(
        scene.props(&doc, frame).fills()[0].kind,
        PaintKind::Solid(Color::WHITE)
    );
}

#[test]
fn removing_a_mode_on_an_unpainted_ancestor_requires_rebuilding() {
    let mut doc = Document::open(&variables_file_with_remote(true)).unwrap();
    let frame = doc.find(Guid::parse("1:10").unwrap()).unwrap();
    doc.nodes[frame as usize].props.fills = None;
    let mut scene = Scene::build(&doc, doc.pages[0]);
    doc.nodes[frame as usize].props.mode_by_set = None;
    assert!(!scene.refresh(&doc, &[frame]));
    let scene = Scene::build(&doc, doc.pages[0]);
    let instance = scene.find(&doc, "I1:30;1:21").unwrap();
    assert_eq!(
        scene.props(&doc, instance).fills()[0].kind,
        PaintKind::Solid(Color::WHITE)
    );
}
