# Local OpenSearch with the analysis-icu plugin baked in. The channels index
# mapping uses a custom `content_text` analyzer whose `icu_folding` filter comes
# from analysis-icu, which the stock image does not ship. Baking it at build time
# (vs installing on every container start) keeps startup fast and offline-safe.
#
# Pinned to 3.5 to match the AWS dev/prod domain engine version
# (infra/stacks/opensearch: `OpenSearch_3.5`).
FROM opensearchproject/opensearch:3.5.0
RUN /usr/share/opensearch/bin/opensearch-plugin install --batch analysis-icu
