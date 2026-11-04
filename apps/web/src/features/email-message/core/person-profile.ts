/** Public professional profile of someone the viewer emails. */
export interface PersonProfile {
  linkedinUrl?: string;
  headline?: string;
  title?: string;
  organizationName?: string;
  photoUrl?: string;
}

/** One line about the person: their headline, else their role and employer. */
export function personProfileSummary(
  profile: PersonProfile
): string | undefined {
  if (profile.headline) return profile.headline;
  const role = [profile.title, profile.organizationName]
    .filter(Boolean)
    .join(' · ');
  return role || undefined;
}
