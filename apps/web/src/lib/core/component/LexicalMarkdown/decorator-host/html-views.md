# HTML decorator row

`createNativeFastHTMLDecoratorViews` projects the actual HTML and optional color
hint through adapter V2. The initialized Source registry remains authoritative,
including its lazy component and Suspense wrapper. No second renderer or model
node is constructed, and public node props are unchanged.

This leaf supplies component props only. Macro's native DOM renderer owns the
mount element and its attributes. The Chrome class/style attribute-order
frontier remains blocking: Source currently serializes style before the mount
class while the native capture puts class first. Do not normalize attributes or
insert an unproven style flush to hide that difference. Observer ordering and an
active-element read did not reproduce the Source order in the browser control.

The typed row does not establish mounted parity, complete registry activation or
installation. Preserve prior failures and use a matched ordinary-native bundle
for additional literal DOM/JSON and interaction checks.
