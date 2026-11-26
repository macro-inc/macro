# OTTL conditions the definitions are written in.
rec {
  attr = key: ''attributes["${key}"]'';
  present = key: "${attr key} != nil";
  is = key: value: ''${attr key} == "${value}"'';
  isNot = key: value: ''${attr key} != "${value}"'';
  service = name: ''resource.attributes["service.name"] == "${name}"'';
  same = key: { ${key} = [ key ]; };
}
