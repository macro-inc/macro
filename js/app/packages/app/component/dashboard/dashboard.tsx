import { Hero } from './sections/hero';
import { QuickLinksSection } from './sections/quick-links';
import { RecentChannelsSection } from './sections/recent-channels';

export function Dashboard() {
  return (
    <main class="relative h-full overflow-y-auto bg-surface text-ink">
      <Hero />

      <div class="px-6 pb-10 sm:px-8">
        <div class="grid w-full gap-x-8 gap-y-10 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div class="space-y-10">
            <QuickLinksSection />

            <RecentChannelsSection />

            <div class="grid gap-8 lg:grid-cols-2">
              <section>
                <div class="mb-4 flex items-center justify-between gap-4">
                  <h2 class="text-lg font-semibold tracking-tight text-ink">
                    Signal
                  </h2>
                  <div class="h-8 w-24 rounded-lg border border-edge-muted bg-hover" />
                </div>

                <div class="divide-y divide-edge-muted overflow-hidden rounded-2xl border border-edge-muted bg-accent/5">
                  <div class="flex h-16 items-center gap-4 px-4">
                    <div class="size-9 rounded-lg bg-accent/10" />
                    <div class="min-w-0 flex-1 space-y-2">
                      <div class="h-3 w-3/5 rounded-full bg-ink/10" />
                      <div class="h-2.5 w-2/5 rounded-full bg-ink/5" />
                    </div>
                    <div class="h-6 w-14 rounded-full bg-accent/10" />
                  </div>
                  <div class="flex h-16 items-center gap-4 px-4">
                    <div class="size-9 rounded-lg bg-accent/10" />
                    <div class="min-w-0 flex-1 space-y-2">
                      <div class="h-3 w-1/2 rounded-full bg-ink/10" />
                      <div class="h-2.5 w-1/3 rounded-full bg-ink/5" />
                    </div>
                    <div class="h-6 w-14 rounded-full bg-accent/10" />
                  </div>
                  <div class="flex h-16 items-center gap-4 px-4">
                    <div class="size-9 rounded-lg bg-accent/10" />
                    <div class="min-w-0 flex-1 space-y-2">
                      <div class="h-3 w-2/5 rounded-full bg-ink/10" />
                      <div class="h-2.5 w-1/4 rounded-full bg-ink/5" />
                    </div>
                    <div class="h-6 w-14 rounded-full bg-accent/10" />
                  </div>
                </div>
              </section>

              <section>
                <div class="mb-4 flex items-center justify-between gap-4">
                  <h2 class="text-lg font-semibold tracking-tight text-ink">
                    Tasks
                  </h2>
                  <div class="h-8 w-24 rounded-lg border border-edge-muted bg-hover" />
                </div>

                <div class="divide-y divide-edge-muted overflow-hidden rounded-2xl border border-edge-muted">
                  <div class="flex h-14 items-center gap-3 px-4">
                    <div class="size-5 rounded-md border border-edge-muted bg-surface" />
                    <div class="min-w-0 flex-1 space-y-2">
                      <div class="h-3 w-3/5 rounded-full bg-ink/10" />
                      <div class="h-2.5 w-1/4 rounded-full bg-ink/5" />
                    </div>
                  </div>
                  <div class="flex h-14 items-center gap-3 px-4">
                    <div class="size-5 rounded-md border border-edge-muted bg-surface" />
                    <div class="min-w-0 flex-1 space-y-2">
                      <div class="h-3 w-1/2 rounded-full bg-ink/10" />
                      <div class="h-2.5 w-1/3 rounded-full bg-ink/5" />
                    </div>
                  </div>
                  <div class="flex h-14 items-center gap-3 px-4">
                    <div class="size-5 rounded-md border border-edge-muted bg-surface" />
                    <div class="min-w-0 flex-1 space-y-2">
                      <div class="h-3 w-2/5 rounded-full bg-ink/10" />
                      <div class="h-2.5 w-1/5 rounded-full bg-ink/5" />
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <div class="grid gap-8 lg:grid-cols-2">
              <section>
                <div class="mb-4 flex items-center justify-between gap-4">
                  <h2 class="text-lg font-semibold tracking-tight text-ink">
                    Shared with me
                </h2>
                <div class="h-8 w-24 rounded-lg border border-edge-muted bg-hover" />
              </div>

              <div class="divide-y divide-edge-muted overflow-hidden rounded-2xl border border-edge-muted">
                <div class="flex h-16 items-center gap-4 px-4">
                  <div class="size-9 rounded-lg bg-[#F7F1E8]" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-3 w-1/2 rounded-full bg-ink/10" />
                    <div class="h-2.5 w-1/3 rounded-full bg-ink/5" />
                  </div>
                  <div class="h-6 w-16 rounded-full bg-ink/5" />
                </div>
                <div class="flex h-16 items-center gap-4 px-4">
                  <div class="size-9 rounded-lg bg-[#EEF4ED]" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-3 w-2/5 rounded-full bg-ink/10" />
                    <div class="h-2.5 w-1/4 rounded-full bg-ink/5" />
                  </div>
                  <div class="h-6 w-16 rounded-full bg-ink/5" />
                </div>
                <div class="flex h-16 items-center gap-4 px-4">
                  <div class="size-9 rounded-lg bg-[#F8F3D9]" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-3 w-1/3 rounded-full bg-ink/10" />
                    <div class="h-2.5 w-1/5 rounded-full bg-ink/5" />
                  </div>
                  <div class="h-6 w-16 rounded-full bg-ink/5" />
                </div>
              </div>
              </section>

              <section>
              <div class="mb-4 flex items-center justify-between gap-4">
                <h2 class="text-lg font-semibold tracking-tight text-ink">
                  Recents
                </h2>
                <div class="h-8 w-32 rounded-lg border border-edge-muted bg-hover" />
              </div>

              <div class="divide-y divide-edge-muted overflow-hidden rounded-2xl border border-edge-muted">
                <div class="flex h-16 items-center gap-4 px-4">
                  <div class="size-9 rounded-lg bg-[#F7F1E8]" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-3 w-2/5 rounded-full bg-ink/10" />
                    <div class="h-2.5 w-1/4 rounded-full bg-ink/5" />
                  </div>
                  <div class="h-6 w-16 rounded-full bg-ink/5" />
                </div>
                <div class="flex h-16 items-center gap-4 px-4">
                  <div class="size-9 rounded-lg bg-[#EEF4ED]" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-3 w-1/2 rounded-full bg-ink/10" />
                    <div class="h-2.5 w-1/3 rounded-full bg-ink/5" />
                  </div>
                  <div class="h-6 w-16 rounded-full bg-ink/5" />
                </div>
                <div class="flex h-16 items-center gap-4 px-4">
                  <div class="size-9 rounded-lg bg-[#F4EEF8]" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-3 w-1/3 rounded-full bg-ink/10" />
                    <div class="h-2.5 w-1/5 rounded-full bg-ink/5" />
                  </div>
                  <div class="h-6 w-16 rounded-full bg-ink/5" />
                </div>
                <div class="flex h-16 items-center gap-4 px-4">
                  <div class="size-9 rounded-lg bg-[#F8F3D9]" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-3 w-2/5 rounded-full bg-ink/10" />
                    <div class="h-2.5 w-1/4 rounded-full bg-ink/5" />
                  </div>
                  <div class="h-6 w-16 rounded-full bg-ink/5" />
                </div>
              </div>
              </section>
            </div>

            <div class="grid gap-8 lg:grid-cols-2">
              <section>
                <div class="mb-4 flex items-center justify-between gap-4">
                  <h2 class="text-lg font-semibold tracking-tight text-ink">
                    Automations
                  </h2>
                  <div class="h-8 w-24 rounded-lg border border-edge-muted bg-hover" />
                </div>

                <div class="grid gap-3">
                  <div class="h-24 rounded-2xl border border-edge-muted bg-[#EEF4ED]" />
                  <div class="h-24 rounded-2xl border border-edge-muted bg-[#EEF4ED]" />
                  <div class="h-24 rounded-2xl border border-edge-muted bg-[#EEF4ED]" />
                </div>
              </section>

              <section>
                <div class="mb-4 flex items-center justify-between gap-4">
                  <h2 class="text-lg font-semibold tracking-tight text-ink">
                    Drafts
                  </h2>
                  <div class="h-8 w-24 rounded-lg border border-edge-muted bg-hover" />
                </div>

                <div class="divide-y divide-edge-muted overflow-hidden rounded-2xl border border-edge-muted">
                  <div class="flex h-16 items-center gap-4 px-4">
                    <div class="size-9 rounded-lg bg-[#FFF0E8]" />
                    <div class="min-w-0 flex-1 space-y-2">
                      <div class="h-3 w-1/2 rounded-full bg-ink/10" />
                      <div class="h-2.5 w-1/3 rounded-full bg-ink/5" />
                    </div>
                    <div class="h-6 w-16 rounded-full bg-ink/5" />
                  </div>
                  <div class="flex h-16 items-center gap-4 px-4">
                    <div class="size-9 rounded-lg bg-[#F8F3D9]" />
                    <div class="min-w-0 flex-1 space-y-2">
                      <div class="h-3 w-2/5 rounded-full bg-ink/10" />
                      <div class="h-2.5 w-1/4 rounded-full bg-ink/5" />
                    </div>
                    <div class="h-6 w-16 rounded-full bg-ink/5" />
                  </div>
                  <div class="flex h-16 items-center gap-4 px-4">
                    <div class="size-9 rounded-lg bg-[#F7F1E8]" />
                    <div class="min-w-0 flex-1 space-y-2">
                      <div class="h-3 w-1/3 rounded-full bg-ink/10" />
                      <div class="h-2.5 w-1/5 rounded-full bg-ink/5" />
                    </div>
                    <div class="h-6 w-16 rounded-full bg-ink/5" />
                  </div>
                </div>
              </section>
            </div>

          </div>

          <aside class="space-y-8">
            <section>
              <div class="mb-4 flex items-center justify-between gap-4">
                <h2 class="text-lg font-semibold tracking-tight text-ink">
                  Notifications
                </h2>
                <div class="h-7 w-14 rounded-full border border-edge-muted bg-hover" />
              </div>

              <div class="divide-y divide-edge-muted overflow-hidden rounded-2xl border border-edge-muted">
                <div class="flex h-14 items-center gap-3 px-3">
                  <div class="size-8 rounded-lg bg-accent/10" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-2.5 w-4/5 rounded-full bg-ink/10" />
                    <div class="h-2 w-1/2 rounded-full bg-ink/5" />
                  </div>
                </div>
                <div class="flex h-14 items-center gap-3 px-3">
                  <div class="size-8 rounded-lg bg-[#F8F3D9]" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-2.5 w-3/5 rounded-full bg-ink/10" />
                    <div class="h-2 w-2/5 rounded-full bg-ink/5" />
                  </div>
                </div>
                <div class="flex h-14 items-center gap-3 px-3">
                  <div class="size-8 rounded-lg bg-[#F4EEF8]" />
                  <div class="min-w-0 flex-1 space-y-2">
                    <div class="h-2.5 w-2/3 rounded-full bg-ink/10" />
                    <div class="h-2 w-1/3 rounded-full bg-ink/5" />
                  </div>
                </div>
              </div>
            </section>

            <section class="rounded-2xl border border-edge-muted bg-[#EAF6F6] p-5">
              <h2 class="mb-4 text-lg font-semibold tracking-tight text-ink">
                Team members
              </h2>

              <div class="mb-4 h-10 rounded-xl bg-surface/80" />
              <div class="mb-4 grid grid-cols-2 gap-3">
                <div class="h-20 rounded-xl bg-surface/70" />
                <div class="h-20 rounded-xl bg-surface/70" />
              </div>
              <div class="space-y-2">
                <div class="h-12 rounded-xl bg-surface/70" />
                <div class="h-12 rounded-xl bg-surface/70" />
                <div class="h-12 rounded-xl bg-surface/70" />
                <div class="h-12 rounded-xl bg-surface/70" />
              </div>
            </section>

            <section>
              <h2 class="mb-4 text-lg font-semibold tracking-tight text-ink">
                Priorities
              </h2>
              <div class="space-y-2">
                <div class="h-14 rounded-2xl border border-edge-muted bg-accent/5" />
                <div class="h-14 rounded-2xl border border-edge-muted bg-accent/5" />
                <div class="h-14 rounded-2xl border border-edge-muted bg-accent/5" />
              </div>
            </section>

            <section>
              <h2 class="mb-4 text-lg font-semibold tracking-tight text-ink">
                Today
              </h2>
              <div class="space-y-2">
                <div class="h-12 rounded-2xl border border-edge-muted bg-[#F8F3D9]" />
                <div class="h-12 rounded-2xl border border-edge-muted bg-[#F8F3D9]" />
                <div class="h-12 rounded-2xl border border-edge-muted bg-[#F8F3D9]" />
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
