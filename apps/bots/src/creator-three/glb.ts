/** Minimal reader for the one-mesh head scan GLB (no materials, no morphs), so no loader dependency is needed. */
export type Scan = {
  position: Float32Array;
  normal: Float32Array;
  uv: Float32Array;
  ao: Float32Array;
  index: Uint32Array;
};

type Accessor = {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
};
type View = { byteOffset?: number };

export function parseScan(buffer: ArrayBuffer): Scan {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67)
    throw new Error('head scan is not a GLB');
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))
  );
  const bin = 20 + jsonLength + 8;
  const primitive = json.meshes[0].primitives[0];
  const read = <T>(
    index: number,
    make: (offset: number, count: number, accessor: Accessor) => T
  ) => {
    const accessor: Accessor = json.accessors[index];
    const bufferView: View = json.bufferViews[accessor.bufferView];
    return make(
      bin + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
      accessor.count,
      accessor
    );
  };
  const floats =
    (size: number) => (offset: number, count: number, accessor: Accessor) => {
      if (accessor.componentType !== 5126)
        throw new Error('unexpected head scan layout');
      return new Float32Array(buffer.slice(offset, offset + count * size * 4));
    };
  const index = read(primitive.indices, (offset, count, accessor) => {
    if (accessor.componentType !== 5125)
      throw new Error('unexpected head scan index');
    return new Uint32Array(buffer.slice(offset, offset + count * 4));
  });
  const position = read(primitive.attributes.POSITION, floats(3));
  const ao = read(primitive.attributes.COLOR_0, (offset, count, accessor) => {
    const out = new Float32Array(count);
    if (accessor.componentType !== 5121) return out.fill(1);
    const stride = accessor.type === 'VEC4' ? 4 : 3;
    const bytes = new Uint8Array(buffer, offset, count * stride);
    for (let i = 0; i < count; i++) out[i] = bytes[i * stride] / 255;
    return out;
  });
  return {
    position,
    normal: read(primitive.attributes.NORMAL, floats(3)),
    uv: read(primitive.attributes.TEXCOORD_0, floats(2)),
    ao,
    index,
  };
}
