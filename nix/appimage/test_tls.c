#include <gio/gio.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(int argc, char **argv) {
    GTlsBackend *backend = g_tls_backend_get_default();
    if (!g_tls_backend_supports_tls(backend)) {
        fprintf(stderr, "Bundled TLS backend was not loaded\n");
        return EXIT_FAILURE;
    }
    g_autoptr(GTlsDatabase) database = g_tls_backend_get_default_database(backend);
    if (argc == 2 && strcmp(argv[1], "reject") == 0) {
        if (database != NULL) {
            fprintf(stderr, "Invalid explicit CA bundle was not rejected\n");
            return EXIT_FAILURE;
        }
        puts("Invalid explicit CA bundle rejected (no fallback)");
        return EXIT_SUCCESS;
    }
    if (!G_IS_TLS_FILE_DATABASE(database)) {
        fprintf(stderr, "TLS backend did not use the explicit CA bundle\n");
        return EXIT_FAILURE;
    }
    g_autofree char *anchors = NULL;
    g_object_get(database, "anchors", &anchors, NULL);
    if (g_strcmp0(anchors, g_getenv("SSL_CERT_FILE")) != 0) {
        fprintf(stderr, "TLS backend changed the requested trust roots\n");
        return EXIT_FAILURE;
    }
    puts("Bundled TLS backend loaded the requested CA bundle");
    return EXIT_SUCCESS;
}
