use super::*;

#[test]
fn ops_read_as_the_editor_sends_them() {
    let ops: Vec<Op> = serde_json::from_str(
        r#"[
            {"op":"setLayer","ids":[3],"opacity":128,"blend":"multiply","visible":false},
            {"op":"newLayer","parent":null,"position":{"type":"above","id":3},"name":null,"kind":{"type":"pixel"}},
            {"op":"translate","ids":[3,4],"dx":5,"dy":-2},
            {"op":"paint","id":3,"stroke":1,"brush":{"size":10,"hardness":1,"opacity":1,"flow":1,"spacing":0.25,"color":{"r":1,"g":0,"b":0},"mode":"paint","pencil":false,"pressureSize":false,"pressureOpacity":false},"points":[[1,2,0.5]]},
            {"op":"setFill","id":5,"fill":{"type":"solid","color":{"r":0,"g":0,"b":1}},"stroke":null},
            {"op":"crop","rect":{"x":0,"y":0,"w":10,"h":10}}
        ]"#,
    )
    .expect("ops parse");
    assert_eq!(ops.len(), 6);
    match &ops[0] {
        Op::SetLayer { ids, patch } => {
            assert_eq!(ids, &[3]);
            assert_eq!(patch.opacity, Some(128));
            assert_eq!(patch.blend, Some(BlendMode::Multiply));
            assert_eq!(patch.visible, Some(false));
            assert_eq!(patch.name, None);
        }
        other => panic!("{other:?}"),
    }
    match &ops[1] {
        Op::NewLayer { position, .. } => assert_eq!(*position, Position::Above(3)),
        other => panic!("{other:?}"),
    }
    match &ops[4] {
        Op::SetFill { stroke, .. } => assert_eq!(*stroke, Some(None)),
        other => panic!("{other:?}"),
    }
}
