import type { CustomToolChoice } from './savings-calculator';

// Monthly USD cents for automatic estimates. Published rates checked Nov 9, 2026.
// Each group is one subscription, even when several included apps are selected.
const subscriptions = [
  // Microsoft 365 Business Premium with Copilot; microsoft.com/en-us/microsoft-365/business/microsoft-365-plans-and-pricing
  { apps: ['Outlook', 'Teams', 'Word', 'Excel'], monthlyCents: 3200 },
  // Workspace Business Plus; workspace.google.com/pricing
  { apps: ['Google Workspace'], monthlyCents: 2200 },
  // Discord's free chat plan; discord.com
  { apps: ['Discord'], monthlyCents: 0 },
  // Premium; atlassian.com/en/software/confluence/pricing (published snapshot)
  { apps: ['Confluence'], monthlyCents: 1044 },
  // Business; airtable.com/pricing
  { apps: ['Airtable'], monthlyCents: 4500 },
  // Advanced; dropbox.com/business/plans-comparison
  { apps: ['Dropbox'], monthlyCents: 2400 },
  // Business; zoom.us/pricing
  { apps: ['Zoom'], monthlyCents: 1833 },
  // Teams; calendly.com/help/choose-the-right-calendly-plan-for-your-team
  { apps: ['Calendly'], monthlyCents: 1600 },
  // Teams; cal.com/pricing
  { apps: ['Cal.com'], monthlyCents: 1200 },
  // Business; miro.com/business-plan
  { apps: ['Miro'], monthlyCents: 2000 },
  // Organization Collab seat; figma.com/pricing
  { apps: ['FigJam'], monthlyCents: 500 },
  // Team estimate; wavelengthflow.com/alternatives/lucidchart-pricing.html
  { apps: ['Lucidchart'], monthlyCents: 1000 },
];

export function additionalAppCosts(
  selected: readonly string[]
): CustomToolChoice[] {
  return subscriptions
    .filter((subscription) =>
      subscription.apps.some((app) => selected.includes(app))
    )
    .map(({ monthlyCents }) => ({ selected: true, monthlyCents }));
}
