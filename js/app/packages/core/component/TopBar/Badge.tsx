export function ViewOnlyBadge() {
  return (
    <div class="hidden sm:flex px-2 rounded-lg border-1 border-accent/30 py-0.5 bg-accent/10 justify-center items-center">
      <p
        class="text-accent-ink text-xs font-medium whitespace-nowrap"
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
    <div class="hidden sm:flex px-2 rounded-lg border-1 border-orange-200 py-0.5 bg-orange-50 justify-center items-center">
      <p
        class="text-orange-500 text-xs font-medium whitespace-nowrap"
        aria-label="Comment Only Badge"
      >
        Comment Only
      </p>
    </div>
  );
}
