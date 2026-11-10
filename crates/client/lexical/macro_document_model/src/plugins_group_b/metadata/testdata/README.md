# Metadata import controls

These literal strings are exports from actual Source editors with document
metadata and stable node IDs registered. Compare exported bytes directly;
object equality would miss state-key order.

The root-order input places documentMetadata before an unknown sentinel and id.
Source emits the sentinel first, then id and documentMetadata. The immutable
execution-bound Source receipt has SHA
`e85063a242345ba0cb23cbdcdacdf89643961f16ac978d8602729b0aae0c75e2`;
its input/output SHA values are `bd1b387edd8b22b7c04f15768a13de64d348e9f0596f17f9fd25ba6b5bc14d58`
and `e6c140aeb3b7752a3cb75ae3b53a60a1d0e516afbc6e63874a23f65c22e84332`.

The equation input is the actual fresh factory model; the output is its actual
Source parse/export trace. Parsing adds environmentTags:null. The input/output
SHA values are `746c9ebfb22d1db1ab490f70902d5833a8f4a89760cacc9ef4c6d2689f2424a7`
and `1182ba8daaacdeaf6c55a8210aa91459f825e83be2e361607b2f06ead7a8ddfa`.
Both producing browser epochs verified pristine compiled Lexical and code-core
source maps and actual served module bodies. These are public-model controls;
cold collaboration persistence still requires its real socket/WAL/VV proof.
