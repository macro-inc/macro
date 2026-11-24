import Play from "@icon/system/fill/play-fill.svg";
import ArrowRight from "@icon/system/regular/arrow-right.svg";
import Check from "@icon/system/regular/check.svg";
import Minus from "@icon/system/regular/minus.svg";
import { createSignal, For, type JSX, Show } from "solid-js";
import { isServer } from "solid-js/web";
import markDesyncPlaceholder from "../../assets/mark-desync-placeholder.jpg";
import { FeaturePageFaq } from "../../features/marketing/components/FeaturePage";
import { HomepageClosing } from "../../features/marketing/components/HomepageClosing";
import { SavingsCalculator } from "../../features/marketing/components/pricing/SavingsCalculator";
import {
	ProductHero,
	ProductPage,
} from "../../features/marketing/components/product/ProductPage";
import { APP_BASE_URL } from "../utils/utilBaseUrl";
import {
	ctaHref,
	demoHref,
	handleCtaClick,
	handleDemoClick,
} from "../utils/utilCta";
import { setPageSeo } from "../utils/utilSeo";
import "./RoutePricing.css";

type Billing = "annual" | "monthly";

type Plan = {
	key: "free" | "pro" | "business" | "max";
	name: string;
	/** Per seat per month: the same at both billings, or annual and monthly. */
	price: string | Record<Billing, string>;
	note: string;
	service: "Self-serve" | "White-glove" | null;
	cta: string;
	event: string;
	features: readonly string[];
};

const plans: readonly Plan[] = [
	{
		key: "free",
		name: "Free",
		price: "$0",
		note: "Start here.",
		service: null,
		cta: "Start for free",
		event: "pricing_free_connect_google",
		features: [
			"Gemini Flash · Limited AI usage",
			"2 email accounts · 5 GB storage",
		],
	},
	{
		key: "pro",
		name: "Pro",
		price: "$40",
		note: "30 days free",
		service: "Self-serve",
		cta: "Try Pro",
		event: "pricing_paid_connect_google",
		features: [
			"All AI models · Standard usage",
			"Unlimited email accounts · 100 GB storage",
			"Calls, recording, and transcription",
		],
	},
	{
		key: "business",
		name: "Business",
		price: { annual: "$80", monthly: "$90" },
		note: "3× Pro usage",
		service: "White-glove",
		cta: "Get Business",
		event: "pricing_business_connect_google",
		features: [
			"All AI models · 3× Pro usage · Higher routine limits",
			"SSO/SAML, signed DPA, security and IT reviews",
			"Annual contracts, invoicing, and priority support",
		],
	},
	{
		key: "max",
		name: "Max",
		price: { annual: "$200", monthly: "$220" },
		note: "10× Pro usage",
		service: "White-glove",
		cta: "Get Max",
		event: "pricing_max_connect_google",
		features: [
			"All AI models · 10× Pro usage",
			"Unlimited email accounts · 1 TB storage",
			"Everything in Business",
		],
	},
];

function planPrice(plan: Plan, billing: Billing) {
	return typeof plan.price === "string" ? plan.price : plan.price[billing];
}

function priceTerms(plan: Plan, billing: Billing) {
	if (typeof plan.price === "string") {
		return plan.key === "free"
			? "per seat / month"
			: "per seat / month, billed monthly";
	}
	return billing === "annual"
		? "per seat / month, billed annually"
		: "per seat / month, billed monthly";
}

type CellValue = boolean | string;

const comparisonGroups: Array<{
	group: string;
	rows: Array<{
		label: string;
		free: CellValue;
		pro: CellValue;
		business: CellValue;
		max: CellValue;
	}>;
}> = [
	{
		group: "AI and agents",
		rows: [
			{
				label: "AI usage",
				free: "Limited",
				pro: "Standard",
				business: "3× Pro",
				max: "10× Pro",
			},
			{
				label: "AI models",
				free: "Gemini Flash",
				pro: "All",
				business: "All",
				max: "All",
			},
			{
				label: "Agents with workspace context",
				free: true,
				pro: true,
				business: true,
				max: true,
			},
			{
				label: "Routines drafting at once",
				free: "3",
				pro: "3",
				business: "10",
				max: "10",
			},
			{
				label: "Active sub-routines per routine",
				free: "50",
				pro: "50",
				business: "200",
				max: "200",
			},
		],
	},
	{
		group: "Workspace",
		rows: [
			{
				label: "Connected email accounts",
				free: "Up to 2",
				pro: "Unlimited",
				business: "Unlimited",
				max: "Unlimited",
			},
			{
				label: "Storage",
				free: "5 GB",
				pro: "100 GB",
				business: "500 GB",
				max: "1 TB",
			},
			{
				label: "Calls, recording, and transcription",
				free: false,
				pro: true,
				business: true,
				max: true,
			},
		],
	},
	{
		group: "Branding and teams",
		rows: [
			{
				label: '"Sent with Macro" email footer',
				free: "Added",
				pro: "Removed",
				business: "Removed",
				max: "Removed",
			},
			{
				label: "Team-level memory for your agents",
				free: true,
				pro: true,
				business: true,
				max: true,
			},
			{
				label: "Subteams",
				free: false,
				pro: false,
				business: "Coming soon",
				max: "Coming soon",
			},
		],
	},
	{
		group: "Security and billing",
		rows: [
			{
				label: "SSO/SAML",
				free: false,
				pro: false,
				business: true,
				max: true,
			},
			{
				label: "Signed DPA",
				free: false,
				pro: false,
				business: true,
				max: true,
			},
			{
				label: "Security and IT reviews",
				free: false,
				pro: false,
				business: true,
				max: true,
			},
			{
				label: "Billing",
				free: "—",
				pro: "Monthly",
				business: "Annual or monthly",
				max: "Annual or monthly",
			},
			{
				label: "Annual contract, invoice, PO, net-30",
				free: false,
				pro: false,
				business: true,
				max: true,
			},
			{
				label: "Onboarding",
				free: "Self-serve",
				pro: "Self-serve",
				business: "White-glove",
				max: "White-glove",
			},
			{
				label: "Priority support",
				free: false,
				pro: false,
				business: true,
				max: true,
			},
		],
	},
];

const faqItems: Array<{ q: string; a: JSX.Element }> = [
	{
		q: "What's the main purpose of Macro?",
		a: (
			<>
				Macro combines email, chat, documents, tasks, calls, and agents. Read
				them in one inbox, search across the workspace, and use agents to edit
				documents, draft replies, and update tasks. Documents use CRDTs for live
				collaboration and offline sync.
			</>
		),
	},
	{
		q: "How does Macro compare to Notion?",
		a: (
			<>
				Macro is a replacement for Notion. Notion is built on markdown and
				databases; Macro has purpose-built modules for each job, plus native
				email, messaging, and file storage. You can still{" "}
				<a href="/docs/switch-to-macro#import-from-notion">
					import your Notion workspace
				</a>{" "}
				with the dedicated importer, or keep it connected through MCP. See our{" "}
				<a href="https://youtu.be/hyU1XYmxkYM" target="_blank" rel="noreferrer">
					comparison video
				</a>
				.
			</>
		),
	},
	{
		q: "How does Macro compare to Superhuman?",
		a: (
			<>
				Macro Mail uses familiar J / K / E shortcuts, combines your email
				accounts in one inbox, and shares that inbox with messages, @mentions,
				tasks, and agent responses. Agents can search indexed email, draft
				replies, and share threads with your team.
			</>
		),
	},
	{
		q: "How does Macro compare to Slack?",
		a: (
			<>
				Macro Chat shows replies inline and treats conversations as inbox items
				you can mark done. When you can share a document or email thread,
				@mentioning it in a channel grants access to that channel. Agents
				participate in channels and can read the referenced work.
			</>
		),
	},
	{
		q: "Does Macro have its own email or integrate with my email?",
		a: (
			<>
				Macro Mail is an email client, not an email server. We integrate with
				your existing Google Workspace or Gmail account. Outlook and custom
				IMAP/SMTP are a popular request and are coming soon.
			</>
		),
	},
	{
		q: "Can I self-host Macro?",
		a: (
			<>
				Yes, under our AGPL license, though the hosted version is our primary
				focus today. The hosted version has the iOS and Android apps,
				Apple/Google/GitHub approvals, runs on AWS, and maintains a SOC 2 Type
				II audit. For HIPAA, FedRAMP, or other needs, contact{" "}
				<a href="mailto:self-host@macro.com">self-host@macro.com</a>.
			</>
		),
	},
	{
		q: "Is Macro fully open source? What is the license?",
		a: (
			<>
				Yes — fully open source, not "open core". As of May 31 2026 we moved
				from BSL to the AGPLv3, a copyleft license, meaning derivative works
				must also be open source. To build on Macro under a different (e.g.
				closed-source) license, contact{" "}
				<a href="mailto:licensing@macro.com">licensing@macro.com</a>.
			</>
		),
	},
	{
		q: "How do you make money if Macro is open source?",
		a: (
			<>
				From our hosted version, like any other SaaS or AI product, and from
				those who build on top of Macro and prefer a license other than the
				AGPLv3.
			</>
		),
	},
	{
		q: "How do teams work in Macro? Do I need a team?",
		a: (
			<>
				Macro works great solo or as a team, and pricing is the same either way.
				Teams share email, tasks, documents, and calls through workspace
				permissions. Agents can search and read the work you have access to, and
				use memory built from your workspace activity. Team subscriptions
				require a paid seat for every member, and each seat can be Pro,
				Business, or Max.
			</>
		),
	},
	{
		q: "What happens if I hit my AI usage limit?",
		a: (
			<>
				Every plan includes a monthly amount of AI usage. Free has a limited
				allowance for trying Macro, Pro covers standard everyday use, Business
				includes 3× Pro's usage, and Max includes 10× Pro's usage for heavy
				agent work. If you reach your limit, upgrade from billing settings to a
				larger plan. Paid plans can also continue with prepaid credits or usage
				billing, priced at provider list price plus 25%. Included usage resets
				every month, also on annual plans, and does not roll over; each team
				seat has its own allowance.
			</>
		),
	},
	{
		q: "How do credits and usage billing work?",
		a: (
			<>
				Open Settings → Billing to see included usage, its reset date, and your
				credit balance. Buy credits in $10, $25, $50, or $100 packs; they apply
				after included usage and never expire. Usage billing charges your card
				in $10 increments after included usage and credits, up to your chosen
				monthly limit. If a charge fails, update your payment method and
				re-enable usage billing. Team owners buy credits and manage usage
				billing for the team; members can view the balance.
			</>
		),
	},
	{
		q: "Can my team mix plans?",
		a: (
			<>
				Yes. Paid teams can mix Pro, Business, and Max seats; annual teams mix
				Business and Max, since Pro is billed monthly. Manage each member’s plan
				from the Seat plan menu in Settings → Team. Plan changes are prorated
				for the remaining billing period, and upgrades take effect immediately.
				Each seat has its own included AI allowance; unused allowance does not
				transfer between seats. Prepaid credits and usage billing are shared.
				Free teams can include unpaid members.
			</>
		),
	},
	{
		q: "What is the difference between Business and Max?",
		a: (
			<>
				Both are for larger teams and come with white-glove onboarding:
				SSO/SAML, a signed DPA, security and IT reviews, annual contracts with
				invoicing, and priority support. Business includes 3× Pro’s AI usage;
				Max includes 10× for heavy agent work. Both are $80 and $200 per seat
				per month billed annually, or $90 and $220 billed monthly. Pro is
				self-serve and billed monthly. To set up SSO or a contract,{" "}
				<a
					href={demoHref()}
					onClick={() => handleDemoClick("pricing_faq_sales")}
				>
					talk to our team
				</a>
				.
			</>
		),
	},
	{
		q: "How do I manage or cancel my subscription?",
		a: (
			<>
				In Settings → Billing, choose Manage to open the Stripe billing portal.
				You can update your payment method, download invoices, or cancel your
				subscription. After cancellation, your plan stays active until the end
				of the billing period. You can also change your own plan from billing
				settings; on a team, this changes only your seat.
			</>
		),
	},
	{
		q: "How do you use my data?",
		a: (
			<>
				Workspace access follows your sharing permissions. For details on data
				collection, processing, retention, and AI handling, see our{" "}
				<a href="/privacy">privacy policy</a> and{" "}
				<a href="/terms">terms of service</a> for full details.
			</>
		),
	},
	{
		q: "Have you raised venture capital?",
		a: (
			<>
				Yes — about $30M led by a16z, with participation from BoxGroup, 3kVC,
				and others.
			</>
		),
	},
];

function PlanComparison() {
	return (
		<details class="pricing-comparison">
			<summary>
				<span>Compare every plan</span>
				<span class="pricing-disclosure-mark" aria-hidden="true">
					+
				</span>
			</summary>
			<table>
				<caption class="pricing-visually-hidden">
					Free, Pro, Business, and Max plan comparison
				</caption>
				<thead>
					<tr>
						<th scope="col">Plan details</th>
						<For each={plans}>{(plan) => <th scope="col">{plan.name}</th>}</For>
					</tr>
				</thead>
				<For each={comparisonGroups}>
					{(group) => (
						<tbody>
							<tr class="pricing-comparison-group">
								<th colSpan={plans.length + 1} scope="colgroup">
									{group.group}
								</th>
							</tr>
							<For each={group.rows}>
								{(row) => (
									<tr>
										<th scope="row">{row.label}</th>
										<For each={plans}>
											{(plan) => {
												const value = row[plan.key];
												return (
													<td>
														{typeof value === "string" ? (
															value
														) : value ? (
															<Check role="img" aria-label="Included" />
														) : (
															<Minus role="img" aria-label="Not included" />
														)}
													</td>
												);
											}}
										</For>
									</tr>
								)}
							</For>
						</tbody>
					)}
				</For>
			</table>
		</details>
	);
}

function CustomerStory() {
	let video!: HTMLVideoElement;
	const [playing, setPlaying] = createSignal(false);
	const local =
		!isServer && ["localhost", "127.0.0.1"].includes(window.location.hostname);
	const videoUrl = local
		? "/video/desync.mp4"
		: new URL("/video/desync.mp4", APP_BASE_URL).toString();
	const play = () =>
		video
			.play()
			.then(() => setPlaying(true))
			.catch(() => setPlaying(false));
	return (
		<section class="pricing-customer" aria-label="Desync customer story">
			<div>
				<p class="pricing-section-label">Desync runs on Macro</p>
				<blockquote>
					“Macro did not help us get organized. Macro <em>is why</em> we are
					organized.”
				</blockquote>
				<p class="pricing-customer-name">
					Mark Evgenev
					<br />
					<span>Founder/CEO, Desync</span>
				</p>
			</div>
			<div class="pricing-customer-video">
				<video
					ref={video}
					src={videoUrl}
					poster={markDesyncPlaceholder}
					preload="none"
					playsinline
					controls={playing()}
					onEnded={() => setPlaying(false)}
					onError={() => setPlaying(false)}
				/>
				<Show when={!playing()}>
					<button
						type="button"
						onClick={play}
						aria-label="Play Desync customer story"
					>
						<Play aria-hidden="true" />
						<span>Watch their story</span>
					</button>
				</Show>
			</div>
		</section>
	);
}

const BILLINGS: ReadonlyArray<{ key: Billing; label: string }> = [
	{ key: "annual", label: "Billed annually" },
	{ key: "monthly", label: "Billed monthly" },
];

export function RoutePricing() {
	const [billing, setBilling] = createSignal<Billing>("annual");
	setPageSeo({
		title: "Pricing — Macro",
		description:
			"Start free. Pro is $40 per seat per month, self-serve. Business is $80 per seat per month billed annually with 3× Pro usage, SSO/SAML, and a signed DPA. Max is $200 per seat per month billed annually with 10× Pro usage.",
		path: "/pricing",
	});
	return (
		<ProductPage auraAccent="#b0b0b8">
			<div class="pricing-page">
				<ProductHero
					product="Pricing"
					title="A plan for every team."
					description="Start free. Pro is self-serve; Business and Max add more AI, security reviews, and white-glove onboarding for larger teams."
				/>
				<section class="pricing-plan-list" aria-label="Choose a plan">
					<div class="pricing-billing" role="group" aria-label="Billing">
						<For each={BILLINGS}>
							{(option) => (
								<button
									type="button"
									aria-pressed={billing() === option.key}
									onClick={() => setBilling(option.key)}
								>
									{option.label}
								</button>
							)}
						</For>
						<span>Save about 10% on Business and Max with annual billing.</span>
					</div>
					<For each={plans}>
						{(plan) => (
							<article
								class="pricing-plan"
								data-plan={plan.key}
								aria-labelledby={`pricing-plan-${plan.key}`}
							>
								<div class="pricing-plan-name">
									<h2 id={`pricing-plan-${plan.key}`}>{plan.name}</h2>
									<p>{plan.note}</p>
									<Show when={plan.service}>
										{(service) => (
											<p class="pricing-plan-service">{service()}</p>
										)}
									</Show>
								</div>
								<div class="pricing-plan-price">
									<strong>{planPrice(plan, billing())}</strong>
									<span>{priceTerms(plan, billing())}</span>
								</div>
								<ul>
									<For each={plan.features}>
										{(feature) => <li>{feature}</li>}
									</For>
								</ul>
								<div class="pricing-plan-actions">
									<a
										class={`pricing-plan-cta ${plan.key === "pro" ? "site-nav-start" : ""}`}
										href={ctaHref()}
										onClick={(event) => handleCtaClick(event, plan.event)}
									>
										{plan.cta}
										<ArrowRight aria-hidden="true" />
									</a>
									<Show when={plan.service === "White-glove"}>
										<a
											class="pricing-plan-sales"
											href={demoHref()}
											onClick={() =>
												handleDemoClick(`pricing_${plan.key}_talk_to_sales`)
											}
										>
											Talk to sales
										</a>
									</Show>
								</div>
							</article>
						)}
					</For>
					<p class="pricing-included">
						Email, chat, docs, tasks, and agents on every plan.
					</p>
					<PlanComparison />
					<p class="pricing-open-source">
						Paid plans support Macro’s{" "}
						<a href="https://github.com/macro-inc/macro">
							open-source development
						</a>
						.
					</p>
				</section>
				<section
					class="pricing-calculator-section"
					id="savings"
					aria-labelledby="pricing-savings-title"
				>
					<header>
						<h2 id="pricing-savings-title">Compare your costs.</h2>
						<p>Choose the tools your team pays for and the seats you need.</p>
					</header>
					<SavingsCalculator />
					<a class="pricing-text-link" href="/replace-apps">
						See the apps Macro replaces <ArrowRight aria-hidden="true" />
					</a>
				</section>
				<CustomerStory />
				<FeaturePageFaq
					id="pricing-questions"
					title="Questions about pricing"
					items={faqItems}
				/>
			</div>
			<HomepageClosing />
		</ProductPage>
	);
}
