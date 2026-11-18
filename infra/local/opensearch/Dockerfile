# Local OpenSearch with the analysis-icu plugin baked in. The channels index
# mapping uses a custom `content_text` analyzer whose `icu_folding` filter comes
# from analysis-icu, which the stock image does not ship. Baking it at build time
# (vs installing on every container start) keeps startup fast and offline-safe.
#
# Every other bundled plugin is removed: Macro uses only core search and
# analysis-icu, and loading the rest took about 4 of the node's 10 seconds to
# start. Without the security plugin there is no security to disable, so the
# compose service sets no `plugins.security.*` options.
#
# Pinned to 3.5 to match the AWS dev/prod domain engine version
# (infra/stacks/opensearch: `OpenSearch_3.5`).
FROM opensearchproject/opensearch:3.5.0
# A plugin another one depends on can't be removed first, so this takes passes,
# and the build fails unless analysis-icu is all that's left.
RUN /usr/share/opensearch/bin/opensearch-plugin install --batch analysis-icu \
    && for pass in 1 2 3 4; do \
        for plugin in $(/usr/share/opensearch/bin/opensearch-plugin list); do \
            [ "$plugin" = analysis-icu ] || /usr/share/opensearch/bin/opensearch-plugin remove "$plugin" || true; \
        done; \
    done \
    && [ "$(/usr/share/opensearch/bin/opensearch-plugin list)" = analysis-icu ]
