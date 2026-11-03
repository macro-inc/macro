{{- define "macro-env.labels" -}}
app.kubernetes.io/part-of: macro-env
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "macro-env.selector" -}}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/name: {{ .w.name }}
{{- end -}}

{{/* Workloads selected for this install phase. */}}
{{- define "macro-env.enabled" -}}
{{- if or (not .root.Values.onlyInfra) .w.infra -}}true{{- end -}}
{{- end -}}
