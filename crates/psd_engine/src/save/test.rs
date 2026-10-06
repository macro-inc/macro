use super::*;

#[test]
fn blank_documents_have_one_layer() {
    let doc = blank(300, 200, true);
    assert_eq!(doc.roots.len(), 1);
    let bg = doc.layer(doc.roots[0]);
    assert!(bg.background);
    assert_eq!(bg.pixels.content_bounds(), Some(IRect::new(0, 0, 300, 200)));
    let doc = blank(10, 10, false);
    assert!(doc.layer(doc.roots[0]).pixels.is_empty());
}

#[test]
fn artboards_save_move_and_read_back() {
    use crate::document::{OpenOptions, open};
    use crate::edit::{History, NewLayer, Op, Position};
    use crate::model::{Artboard, ArtboardBackground, LayerKind, Rgb};
    use crate::raster::Selection;

    let mut doc = blank(100, 80, false);
    let mut renderer = Renderer::new();
    let mut history = History::default();
    let mut apply = |doc: &mut Document, renderer: &mut Renderer, op: Op| {
        history
            .apply(doc, &[op], &Selection::none(), renderer, None)
            .expect("applies")
    };
    let created = apply(
        &mut doc,
        &mut renderer,
        Op::NewLayer {
            parent: None,
            position: Position::Top,
            name: Some("Board".into()),
            kind: NewLayer::Group,
        },
    )
    .created;
    let board = created[0];
    let i = doc.find(board).expect("the group");
    let artboard = Artboard {
        rect: IRect::new(10, 20, 30, 40),
        background: ArtboardBackground::Color {
            color: Rgb::from_u8(0, 128, 255),
        },
    };
    doc.layer_mut(i).kind = LayerKind::Group {
        open: true,
        artboard: Some(artboard),
    };
    let read_back = |doc: &Document, renderer: &mut Renderer| {
        let bytes = save(doc, renderer).expect("saves");
        let again = open(&bytes, OpenOptions::default())
            .expect("opens")
            .document;
        let j = again.find(board).expect("the group again");
        match &again.layer(j).kind {
            LayerKind::Group { artboard, .. } => *artboard,
            other => panic!("not a group: {other:?}"),
        }
    };
    assert_eq!(read_back(&doc, &mut renderer), Some(artboard));

    // Moving the group moves the artboard; saving writes where it went.
    let reopened = save(&doc, &mut renderer).expect("saves");
    let mut doc = open(&reopened, OpenOptions::default())
        .expect("opens")
        .document;
    apply(
        &mut doc,
        &mut renderer,
        Op::Translate {
            ids: vec![board],
            dx: 5,
            dy: -3,
        },
    );
    let moved = read_back(&doc, &mut renderer).expect("still an artboard");
    assert_eq!(moved.rect, IRect::new(15, 17, 30, 40));
    assert_eq!(moved.background, artboard.background);
}
