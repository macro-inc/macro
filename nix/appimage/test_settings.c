#define _GNU_SOURCE
#include <dlfcn.h>
#include <gio/gio.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    const char *root = getenv("GSETTINGS_SCHEMA_DIR");
    if (root == NULL) {
        fprintf(stderr, "Bundled GSETTINGS_SCHEMA_DIR is missing\n");
        return EXIT_FAILURE;
    }
    g_autoptr(GError) error = NULL;
    // No parent source: the host's installed schemas cannot satisfy this check.
    g_autoptr(GSettingsSchemaSource) source =
        g_settings_schema_source_new_from_directory(root, NULL, FALSE, &error);
    if (source == NULL) {
        fprintf(stderr, "Cannot load bundled schemas: %s\n", error->message);
        return EXIT_FAILURE;
    }

    const char *ids[] = {
        "org.gnome.system.proxy",
        "org.gnome.system.proxy.http",
        "org.gnome.system.proxy.https",
        "org.gnome.system.proxy.ftp",
        "org.gnome.system.proxy.socks",
        "org.gnome.desktop.interface",
        "org.gtk.Settings.FileChooser",
    };
    for (size_t i = 0; i < G_N_ELEMENTS(ids); i++) {
        g_autoptr(GSettingsSchema) schema =
            g_settings_schema_source_lookup(source, ids[i], FALSE);
        if (schema == NULL) {
            fprintf(stderr, "Missing bundled schema: %s\n", ids[i]);
            return EXIT_FAILURE;
        }
        g_autoptr(GSettings) settings = g_settings_new_full(schema, NULL, NULL);
        if (settings == NULL) {
            return EXIT_FAILURE;
        }
    }

    // Test both resolver routes, not just GIO's dummy resolver or XML presence.
    gboolean use_libproxy = g_strcmp0(g_getenv("GIO_USE_PROXY_RESOLVER"), "libproxy") == 0;
    const char *expected = use_libproxy ? "GLibproxyResolver" : "GProxyResolverGnome";
    GProxyResolver *resolver = g_proxy_resolver_get_default();
    if (strcmp(G_OBJECT_TYPE_NAME(resolver), expected) != 0) {
        fprintf(stderr, "Unexpected proxy resolver: %s\n", G_OBJECT_TYPE_NAME(resolver));
        return EXIT_FAILURE;
    }
    g_auto(GStrv) proxies = g_proxy_resolver_lookup(
        resolver, "https://example.invalid/", NULL, &error);
    if (proxies == NULL) {
        fprintf(stderr, "Proxy lookup failed: %s\n", error->message);
        return EXIT_FAILURE;
    }
    if (g_strv_length(proxies) != 1 || strcmp(proxies[0], "direct://") != 0) {
        fprintf(stderr, "Unexpected default proxy configuration\n");
        return EXIT_FAILURE;
    }
    if (use_libproxy) {
        // A store-backed libproxy would pass on NixOS while crashing in Fedora.
        // Check the actual loaded backend, not just the file we meant to copy.
        void *backend = dlopen("libpxbackend-1.0.so", RTLD_LAZY | RTLD_NOLOAD);
        Dl_info info = {0};
        g_autofree char *prefix = g_build_filename(g_getenv("APPDIR"), "usr/lib/", NULL);
        if (backend == NULL ||
            dladdr(dlsym(backend, "px_manager_get_type"), &info) == 0 ||
            !g_str_has_prefix(info.dli_fname, prefix)) {
            fprintf(stderr, "libproxy backend was not loaded from the AppDir\n");
            if (backend != NULL)
                dlclose(backend);
            return EXIT_FAILURE;
        }
        dlclose(backend);
    }
    printf("Bundled GTK/GNOME schemas and %s lookup succeeded: %s\n", expected, root);
    return EXIT_SUCCESS;
}
