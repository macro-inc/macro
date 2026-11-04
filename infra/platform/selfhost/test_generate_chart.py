import json
import unittest

import generate_chart as g


def deployment():
    return {
        "kind": "Deployment",
        "metadata": {
            "name": "email-service",
            "namespace": "macro-selfhost",
            "annotations": {"argocd.argoproj.io/sync-wave": "-2"},
            "labels": {
                "app.kubernetes.io/name": "email-service",
                "macro.com/instance": "selfhost",
            },
        },
        "spec": {
            "replicas": 1,
            "selector": {"matchLabels": {"macro.com/instance": "selfhost"}},
            "template": {
                "metadata": {"labels": {"macro.com/instance": "selfhost"}},
                "spec": {
                    "containers": [
                        {
                            "name": "email-service",
                            "image": "__MACRO_REGISTRY__/macro-email_service:__MACRO_TAG__",
                            "resources": {},
                        }
                    ]
                },
            },
        },
    }


class Chart(unittest.TestCase):
    def render(self, item):
        component, rewritten = g.template_item(item)
        return g.render_document(component, rewritten)

    def test_namespaces_are_left_to_helm(self):
        self.assertIsNone(g.template_item({"kind": "Namespace", "metadata": {}}))

    def test_a_deployment_templates_only_the_allowed_fields(self):
        text = self.render(deployment())
        self.assertIn('{{ index .Values.replicas "email-service" | default 1 }}', text)
        self.assertIn(
            "{{ .Values.image.registry }}/macro-email_service:{{ .Values.image.tag | default .Chart.AppVersion }}",
            text,
        )
        self.assertIn('{{ .Release.Name }}', text)
        self.assertNotIn("argocd", text)
        self.assertNotIn("macro-selfhost", text)
        self.assertTrue(text.startswith('---\n{{- if not (has "email-service"'))

    def test_jobs_get_a_new_name_per_revision(self):
        job = {
            "kind": "Job",
            "metadata": {"name": "provision-abc", "labels": {"macro.com/job": "provision"}},
            "spec": {"template": {"metadata": {"labels": {}}, "spec": {"containers": [{}]}}},
        }
        _, rewritten = g.template_item(job)
        self.assertEqual(rewritten["metadata"]["name"], "provision-{{ .Release.Revision }}")

    def test_ingress_uses_the_host_value_and_optional_tls(self):
        ingress = {
            "kind": "Ingress",
            "metadata": {"name": "edge", "labels": {}},
            "spec": {
                "ingressClassName": "traefik",
                "tls": [{"hosts": ["__MACRO_HOST__"], "secretName": "macro-tls"}],
                "rules": [{"host": "__MACRO_HOST__", "http": {"paths": []}}],
            },
        }
        component, rewritten = g.template_item(ingress)
        text = g.render_document(component, rewritten)
        self.assertIn('"host": "{{ .Values.host }}"', text)
        self.assertIn("{{- if .Values.tls.secretName }}", text)


if __name__ == "__main__":
    unittest.main()
