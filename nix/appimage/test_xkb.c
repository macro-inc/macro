#include <stdio.h>
#include <stdlib.h>
#include <xkbcommon/xkbcommon.h>

int main(void) {
    const char *root = getenv("XKB_CONFIG_ROOT");
    struct xkb_context *context = xkb_context_new(
        XKB_CONTEXT_NO_DEFAULT_INCLUDES | XKB_CONTEXT_NO_ENVIRONMENT_NAMES);
    if (context == NULL) {
        return EXIT_FAILURE;
    }
    // Only the launcher's bundled directory may satisfy this test: no host or
    // Nix store include paths, even when they exist on the build machine.
    if (root == NULL || !xkb_context_include_path_append(context, root)) {
        fprintf(stderr, "Bundled XKB_CONFIG_ROOT is missing or unreadable\n");
        xkb_context_unref(context);
        return EXIT_FAILURE;
    }

    const char *layouts[] = {"us", "de"};
    for (size_t i = 0; i < sizeof(layouts) / sizeof(layouts[0]); i++) {
        struct xkb_rule_names names = {
            .rules = "evdev", .model = "pc105", .layout = layouts[i],
        };
        struct xkb_keymap *keymap = xkb_keymap_new_from_names(
            context, &names, XKB_KEYMAP_COMPILE_NO_FLAGS);
        if (keymap == NULL) {
            fprintf(stderr, "Cannot compile %s keymap from %s\n", layouts[i], root);
            xkb_context_unref(context);
            return EXIT_FAILURE;
        }
        xkb_keymap_unref(keymap);
    }
    printf("XKB keymaps compiled using only %s\n", root);
    xkb_context_unref(context);
    return EXIT_SUCCESS;
}
