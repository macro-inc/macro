export function ViewOnlyBadge() {
  return (
    <div class="hidden sm:flex px-2 rounded-lg border border-accent/30 py-0.5 bg-accent/10 justify-center items-center">
      <p
        class="text-accent text-xs font-medium whitespace-nowrap"
        aria-label="View Only Badge"
      >
        View Only
      </p>
    </div>
  );
}

// SCUFFED THEME: how should we define the comment only badge colors?
export function CommentOnlyBadge() {
  return (
    <div class="hidden sm:flex px-2 rounded-lg border border-[oklch(0.901_0.076_70.697)] py-0.5 bg-[oklch(0.98_0.016_73.684)] justify-center items-center">
      <p
        class="text-[oklch(0.705_0.213_47.604)] text-xs font-medium whitespace-nowrap"
        aria-label="Comment Only Badge"
      >
        Comment Only
      </p>
    </div>
  );
}
