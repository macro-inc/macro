// How long mobile tap targets hold the `.animating` class after a press before clearing
// it (the animated icons are one-shot CSS animations driven by that class). Shared by all
// consumers that pulse an animated icon on tap, so the pulse window stays in sync and is
// long enough to cover the longest one-shot icon animation (currently the channel icon's
// 0.625s expand).
export const ICON_ANIMATION_DURATION_MS = 625;
