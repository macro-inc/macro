#!/usr/bin/env python3
"""Turn a rendered instance into the `macro` Helm chart for self-hosters.

The input is `infra/platform`'s own output, rendered with placeholder host and
image references, so the chart cannot drift from what our clusters run. Only
the fields the parity rule lets environments differ on become values: host and
TLS, image registry and tag, replicas, resources, storage, and whether each
component runs in-cluster at all.
"""

import copy
import json
import pathlib
import re
import sys

HOST = "__MACRO_HOST__"
REGISTRY = "__MACRO_REGISTRY__"
TAG = "__MACRO_TAG__"
INSTANCE = "selfhost"
RAW = re.compile(r'"__TPL__(.*?)__LPT__"')
ALLOWED_KINDS = {
    "ConfigMap",
    "Deployment",
    "Ingress",
    "Job",
    "NetworkPolicy",
    "PersistentVolumeClaim",
    "Service",
}


def tpl(expression):
    """A value rendered unquoted, for numbers and whole objects."""
    return f"__TPL__{expression}__LPT__"


def component_of(item):
    labels = item["metadata"].get("labels", {})
    return labels.get("macro.com/job") or labels.get("app.kubernetes.io/name")


def scrub_metadata(metadata):
    metadata.pop("namespace", None)
    metadata.pop("annotations", None)
    labels = metadata.get("labels", {})
    for key in list(labels):
        if key.startswith("kubenix/"):
            del labels[key]
    if labels.get("macro.com/instance") == INSTANCE:
        labels["macro.com/instance"] = "{{ .Release.Name }}"


def rewrite_pod(template, component):
    scrub_metadata(template["metadata"])
    for container in template["spec"]["containers"]:
        container["resources"] = tpl(
            f'toJson (index .Values.resources "{component}" | default .Values.resources.default)'
        )


def template_item(item):
    """Rewrite one manifest. Returns (component, item) or None to drop it."""
    kind = item["kind"]
    if kind not in ALLOWED_KINDS:
        return None
    item = copy.deepcopy(item)
    component = component_of(item)
    scrub_metadata(item["metadata"])
    if kind == "Deployment":
        spec = item["spec"]
        spec["selector"]["matchLabels"]["macro.com/instance"] = "{{ .Release.Name }}"
        spec["replicas"] = tpl(
            f'index .Values.replicas "{component}" | default 1'
        )
        rewrite_pod(spec["template"], component)
    elif kind == "Job":
        # Job specs are immutable; every upgrade provisions under a new name.
        item["metadata"]["name"] = component + "-{{ .Release.Revision }}"
        rewrite_pod(item["spec"]["template"], component)
    elif kind == "Service":
        item["spec"]["selector"]["macro.com/instance"] = "{{ .Release.Name }}"
    elif kind == "PersistentVolumeClaim":
        item["spec"]["resources"]["requests"]["storage"] = tpl(
            f'(index .Values.storage "{component}" | default .Values.storage.default) | quote'
        )
    elif kind == "NetworkPolicy":
        for rule in item["spec"].get("ingress", []):
            for peer in rule.get("from", []):
                selector = peer.get("namespaceSelector")
                if selector:
                    selector["matchLabels"] = {
                        "kubernetes.io/metadata.name": "{{ .Values.ingress.namespace }}"
                    }
    elif kind == "Ingress":
        item["spec"]["ingressClassName"] = "{{ .Values.ingress.className }}"
    return component, item


def render_document(component, item):
    text = RAW.sub(lambda m: "{{ " + m.group(1).replace('\\"', '"') + " }}", json.dumps(item, indent=2))
    text = text.replace(HOST, "{{ .Values.host }}")
    text = re.sub(
        re.escape(REGISTRY) + r"/macro-([a-zA-Z0-9_.-]+):" + re.escape(TAG),
        r"{{ .Values.image.registry }}/macro-\1:{{ .Values.image.tag | default .Chart.AppVersion }}",
        text,
    )
    if item["kind"] == "Ingress":
        tls = re.compile(r'"tls": \[.*?\n  *\],?\n', re.S)
        text = tls.sub('{{- if .Values.tls.secretName }}\n"tls": [{"hosts": ["{{ .Values.host }}"], "secretName": "{{ .Values.tls.secretName }}"}],\n{{- end }}\n', text)
    if component:
        text = (
            f'{{{{- if not (has "{component}" .Values.disabledComponents) }}}}\n'
            f"{text}\n{{{{- end }}}}\n"
        )
    return f"---\n{text}\n"


def default_resources(size):
    return {
        name: value
        for name, value in sorted(size["resources"].items())
    }


def main():
    manifests_path, size_path, out, version = sys.argv[1:5]
    manifests = json.loads(pathlib.Path(manifests_path).read_text())
    size = json.loads(pathlib.Path(size_path).read_text())
    out = pathlib.Path(out)
    (out / "templates").mkdir(parents=True)

    documents = []
    components = set()
    for item in manifests["items"]:
        templated = template_item(item)
        if templated is None:
            continue
        component, rewritten = templated
        if component:
            components.add(component)
        documents.append(render_document(component, rewritten))
    (out / "templates" / "macro.yaml").write_text("".join(documents))

    (out / "Chart.yaml").write_text(
        "apiVersion: v2\n"
        "name: macro\n"
        "description: Macro, self-hosted.\n"
        "type: application\n"
        f"version: {version}\n"
        f'appVersion: "{version}"\n'
    )
    values = {
        "host": "macro.example.com",
        "tls": {"secretName": "macro-tls"},
        "ingress": {"className": "traefik", "namespace": "traefik"},
        "image": {"registry": "ghcr.io/macro-inc", "tag": ""},
        "disabledComponents": [],
        "replicas": size.get("replicas", {}),
        "resources": default_resources(size),
        "storage": size["storage"],
    }
    (out / "values.yaml").write_text(
        "# Disable a component (for example `postgres`) to use an external endpoint,\n"
        "# and point the `macro-env` Secret at it. All values are in README.md.\n"
        + json.dumps(values, indent=2)
        + "\n"
    )
    (out / "templates" / "NOTES.txt").write_text(
        "Macro is starting at https://{{ .Values.host }}/app/\n"
        "It needs the `macro-env` Secret and the `fusionauth-kickstart` Secret in this\n"
        "namespace first; see the chart README.\n"
    )
    (out / "README.md").write_text(
        "# Macro\n\n"
        "Requirements: Kubernetes 1.30+, a default StorageClass, an ingress controller,\n"
        "and two Secrets in the release namespace: `macro-env` (the environment every\n"
        "service loads) and `fusionauth-kickstart` (`kickstart.json`).\n\n"
        "Components that can be disabled through `disabledComponents`:\n\n"
        + "".join(f"- `{c}`\n" for c in sorted(components))
    )


if __name__ == "__main__":
    main()
