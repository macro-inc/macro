undef $/; $_=<STDIN>;
my $t = <<'T';
  it('shows the preview only while an expanded thread has no replies loaded', () => {
    const view = fixture();
    try {
      expect(view.showsPreviewOnly()).toBe(true);
      view.setExpanded(true);
      // Offline, a thread the device does not hold stays this way.
      expect(view.displayReplies()).toEqual(preview);
      expect(view.showsPreviewOnly()).toBe(true);
      view.setLoaded(replies);
      expect(view.showsPreviewOnly()).toBe(false);
    } finally {
      view.dispose();
    }
  });

T
s/(  it\('does not reveal a cached full thread on mount or remount')/$t$1/ or die 1;
print;
