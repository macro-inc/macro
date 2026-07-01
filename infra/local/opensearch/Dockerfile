# Local OpenSearch with the analysis-icu plugin baked in. The channels index
# mapping uses a custom `content_text` analyzer whose `icu_folding` filter comes
# from analysis-icu, which the stock image does not ship. Baking it at build time
# (vs installing on every container start) keeps startup fast and offline-safe.
FROM opensearchproject/opensearch:latest
RUN /usr/share/opensearch/bin/opensearch-plugin install --batch analysis-icu
