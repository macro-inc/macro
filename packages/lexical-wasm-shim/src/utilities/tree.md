# Actual-node tree source

Parent matching, ancestor/root traversal and captured child-key chains use actual
node methods and the sanctioned existing lookup primitive. Public overloads,
callback order and raw captured fields match the pinned source; no central adapter
call or assertion is added.

removeFromParent retains exact getWritable/getter order, first/last pointers,
sibling links, node link clearing and parent-size write order. Its native raw
write authority is not available on this source base: the real builtin update
rejects the first __first write before changing topology. The negative authority
control is not a native parity pass. Native detachment acceptance remains OPEN;
no Node.remove substitution, new scope token or fake backing graph is supplied.
