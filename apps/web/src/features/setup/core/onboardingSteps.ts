/** Stable keys survive full-page provider callbacks and selection changes. */
export function onboardingStepKeys(integrationIds: readonly string[]) {
  return [
    'welcome',
    'vision',
    'security',
    'email',
    'personal',
    'tools',
    ...integrationIds.map((id) => `connect-${id}`),
    'plan',
    'team',
  ];
}

export function resolveSetupStep(keys: readonly string[], savedKey: string) {
  if (keys.includes(savedKey)) return savedKey;
  if (savedKey === 'privacy') return 'security';
  if (savedKey.startsWith('connect-')) return 'tools';
  if (['explore', 'introduction', 'customize', 'guidance'].includes(savedKey))
    return 'team';
  if (savedKey === 'building' || savedKey === 'summary') return 'plan';
  return 'welcome';
}
