use super::*;
use crate::model::{ArtboardBackground, Layer, LayerMask};
use crate::raster::Raster;

/// A PNG's width, height, and samples.
fn decode(png: &[u8]) -> (u32, u32, Vec<u8>) {
    let decoder = png::Decoder::new(std::io::Cursor::new(png));
    let mut reader = decoder.read_info().expect("a PNG");
    let mut buf = vec![0; reader.output_buffer_size().expect("its size")];
    let info = reader.next_frame(&mut buf).expect("a frame");
    buf.truncate(info.buffer_size());
    (info.width, info.height, buf)
}

#[test]
fn mask_thumbnails_show_the_mask_over_the_canvas() {
    let mut doc = Document::new(100, 50);
    let mut layer = Layer::new(1, "masked");
    // Shows the left half; hides the rest (the default outside its pixels).
    let rect = IRect::new(0, 0, 50, 50);
    layer.mask = Some(LayerMask {
        raster: Raster::from_region(1, rect, &[255; 2500]),
        rect,
        default_color: 0,
        disabled: false,
        linked: true,
        density: 1.0,
        feather: 0.0,
        generation: 0,
    });
    let i = doc.push_layer(layer);
    doc.roots.push(i);
    let (w, h, px) = decode(&mask_thumbnail(&doc, 1, 20));
    assert_eq!((w, h), (20, 10));
    let at = |x: u32, y: u32| px[((y * w + x) * 4) as usize];
    assert_eq!(at(2, 5), 255);
    assert_eq!(at(17, 5), 0);
    // No mask, no thumbnail.
    let plain = doc.push_layer(Layer::new(2, "plain"));
    doc.roots.push(plain);
    assert!(mask_thumbnail(&doc, 2, 20).is_empty());
    assert!(mask_thumbnail(&doc, 99, 20).is_empty());
}

#[test]
fn artboards_show_in_their_rows() {
    let mut doc = Document::new(100, 50);
    let mut board = Layer::new(1, "Board");
    let artboard = Artboard {
        rect: IRect::new(10, 0, 40, 50),
        background: ArtboardBackground::Black,
    };
    board.kind = LayerKind::Group {
        open: true,
        artboard: Some(artboard),
    };
    let i = doc.push_layer(board);
    doc.roots.push(i);
    let rows = layers(&doc);
    assert_eq!(rows[0].kind, "group");
    assert_eq!(rows[0].artboard, Some(artboard));
    let json = serde_json::to_value(&rows[0]).expect("serializes");
    assert_eq!(json["artboard"]["background"]["type"], "black");
    assert_eq!(json["artboard"]["rect"]["x"], 10);
}
