import { For } from 'solid-js';
import { PLAN_COMPARISON } from '../core/planComparison';

export function PlanComparison(props: {
  onContinueGuest: () => void;
  onBackToPro: () => void;
}) {
  return (
    <section class="mx-auto w-full max-w-[608px] px-6 pb-20 pt-20 font-[Inter_Variable] text-sm leading-7 text-ink-muted sm:pb-28 sm:pt-24 sm:text-[15px]">
      <div class="mb-10 h-px w-12 bg-edge" aria-hidden="true" />
      <p class="mb-4 text-xs text-ink-extra-muted">Guest & Pro</p>
      <h2
        tabindex="-1"
        class="mb-7 text-2xl font-medium leading-8 tracking-tight text-ink outline-none sm:text-[28px] sm:leading-9"
      >
        Choose what works for you.
      </h2>
      <p>
        Join your workspace as a Guest for free, with no credit card needed.
        Connect up to two email accounts, use Haiku, and keep up to 5 GB of
        files. Emails you send include a “Sent with Macro” footer.
      </p>
      <p class="mt-5">
        Pro removes the email watermark and account limit, unlocks every AI
        model, and gives you more storage and team features.
      </p>

      <div class="mt-10">
        <table class="w-full table-fixed border-collapse text-left text-xs leading-5 sm:text-sm sm:leading-6">
          <caption class="sr-only">
            Compare Guest access and Pro features
          </caption>
          <thead>
            <tr class="border-b border-edge">
              <th
                scope="col"
                class="w-[38%] pb-5 pr-3 align-top font-medium text-ink sm:pr-6"
              >
                What’s included
              </th>
              <th
                scope="col"
                class="w-[31%] pb-5 pr-3 align-top font-medium text-ink sm:pr-6"
              >
                Guest
                <span class="mt-1.5 block text-xs font-normal leading-5 text-ink-muted">
                  Free
                </span>
              </th>
              <th
                scope="col"
                class="w-[31%] pb-5 align-top font-medium text-ink"
              >
                Pro
                <span class="mt-1.5 block text-xs font-normal leading-5 text-ink-muted [overflow-wrap:anywhere]">
                  30 days free, then $40/user/month
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            <For each={PLAN_COMPARISON}>
              {(row) => (
                <tr class="border-b border-edge-muted last:border-b-0">
                  <th
                    scope="row"
                    class="py-4 pr-3 align-top font-normal text-ink-muted sm:py-5 sm:pr-6"
                  >
                    {row.feature}
                  </th>
                  <td class="py-4 pr-3 align-top text-ink-muted sm:py-5 sm:pr-6">
                    {row.guest}
                  </td>
                  <td class="py-4 align-top text-ink-muted sm:py-5">
                    {row.pro}
                  </td>
                </tr>
              )}
            </For>
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td class="pt-6 pr-3 align-top sm:pr-6">
                <button
                  type="button"
                  onClick={props.onContinueGuest}
                  class="flex min-h-10 w-full max-w-40 items-center justify-center gap-2 rounded-full border border-edge px-2 py-2 text-center text-[11px] font-medium leading-4 text-ink-muted hover:border-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink sm:px-3"
                >
                  <span>Continue as Guest</span>
                </button>
              </td>
              <td class="pt-6 align-top">
                <button
                  type="button"
                  onClick={props.onBackToPro}
                  class="flex min-h-10 w-full max-w-40 items-center justify-center gap-2 rounded-full bg-ink px-2 py-2 text-center text-[11px] font-medium leading-4 text-surface hover:bg-ink/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ink sm:px-3"
                >
                  <span>Continue with Pro</span>
                </button>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
