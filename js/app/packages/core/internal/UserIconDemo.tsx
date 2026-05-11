import { UserGroup } from '@core/component/UserGroup';
import { UserIcon } from '@core/component/UserIcon';
import { seedMockDisplayNames } from '@core/user/displayName';
import User from '@phosphor-icons/core/regular/user.svg?component-solid';
import { Avatar } from '@ui';
import { For } from 'solid-js';

// Mock macro user IDs (format: macro|email@domain.com)
const MOCK_USERS = [
  { id: 'macro|seamus@macro.com', firstName: 'Seamus', lastName: 'Edson' },
  { id: 'macro|teo@macro.com', firstName: 'Teo', lastName: 'Brasoveanu' },
  { id: 'macro|russel@macro.com', firstName: 'Russel', lastName: 'Smith' },
  { id: 'macro|rahul@macro.com', firstName: 'Rahul', lastName: 'Gupta' },
  { id: 'macro|gab@macro.com', firstName: 'Gab', lastName: 'Briones' },
];

const USER_IDS = MOCK_USERS.map((u) => u.id);

const SIZE_LABELS = ['sm', 'md', 'lg'] as const;
type GroupSize = 'sm' | 'md' | 'lg';

// Seed mock display names so tooltips work
seedMockDisplayNames(MOCK_USERS);

function Section(props: { title: string; children: any }) {
  return (
    <div class="space-y-3">
      <h2 class="text-sm font-semibold text-ink-muted uppercase tracking-wide">
        {props.title}
      </h2>
      {props.children}
    </div>
  );
}

function SizeLabel(props: { size: string }) {
  return (
    <span class="text-xs text-ink-extra-muted font-mono w-8">{props.size}</span>
  );
}

export default function UserIconDemo() {
  return (
    <div class="p-8 space-y-12 bg-panel min-h-full overflow-auto">
      <div>
        <h1 class="text-xl font-bold text-ink mb-2">
          UserIcon & UserGroup Demo
        </h1>
        <p class="text-sm text-ink-muted">
          Demonstrates the Avatar primitives from @ui and UserIcon built on top.
        </p>
      </div>

      {/* Raw Avatar primitives */}
      <Section title="Avatar Primitives (@ui)">
        <p class="text-xs text-ink-muted mb-3">
          Pure UI components with no user/API logic. Use these for custom
          avatars.
        </p>
        <div class="flex items-center gap-4">
          <Avatar size="sm">
            <Avatar.Fallback>AB</Avatar.Fallback>
          </Avatar>
          <Avatar size="md">
            <Avatar.Image src="https://i.pravatar.cc/100?img=1" alt="Random" />
          </Avatar>
          <Avatar size="lg">
            <Avatar.Fallback>
              <User class="size-5" />
            </Avatar.Fallback>
          </Avatar>
        </div>
      </Section>

      {/* Individual UserIcons at each size */}
      <Section title="UserIcon - All Sizes">
        <div class="space-y-4">
          <For each={SIZE_LABELS}>
            {(size) => (
              <div class="flex items-center gap-4">
                <SizeLabel size={size} />
                <div class="flex items-center gap-3">
                  <For each={MOCK_USERS}>
                    {(user) => (
                      <UserIcon id={user.id} size={size} suppressClick />
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>

          {/* Fill size needs a container */}
          <div class="flex items-center gap-4">
            <SizeLabel size="fill" />
            <div class="flex items-center gap-3">
              <For each={MOCK_USERS}>
                {(user) => (
                  <div class="size-12">
                    <UserIcon id={user.id} size="fill" suppressClick />
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Section>

      {/* UserGroup at each size */}
      <Section title="UserGroup - All Sizes">
        <div class="space-y-4">
          <For each={SIZE_LABELS}>
            {(size) => (
              <div class="flex items-center gap-4">
                <SizeLabel size={size} />
                <UserGroup
                  userIds={[...USER_IDS]}
                  size={size as GroupSize}
                  suppressClick
                />
              </div>
            )}
          </For>
        </div>
      </Section>

      {/* UserGroup with different maxUsers */}
      <Section title="UserGroup - Max Users Variants">
        <div class="space-y-4">
          <For each={[1, 2, 3, 4, 5]}>
            {(max) => (
              <div class="flex items-center gap-4">
                <span class="text-xs text-ink-extra-muted font-mono w-16">
                  max={max}
                </span>
                <UserGroup
                  userIds={[...USER_IDS]}
                  maxUsers={max}
                  size="sm"
                  suppressClick
                />
              </div>
            )}
          </For>
        </div>
      </Section>

      {/* Hover background test - the main bug fix */}
      <Section title="Hover Background Test">
        <p class="text-xs text-ink-muted mb-3">
          The separator should match the hover background. Add{' '}
          <code class="bg-edge px-1 rounded">
            hover:[--avatar-group-separator:var(--color-hover)]
          </code>{' '}
          to the parent.
        </p>

        <div class="space-y-2">
          {/* Without the fix */}
          <div class="flex items-center gap-4">
            <span class="text-xs text-ink-extra-muted font-mono w-24">
              without fix
            </span>
            <div class="flex items-center gap-2 px-3 py-2 rounded hover:bg-hover transition-colors border border-edge-muted">
              <UserGroup
                userIds={[...USER_IDS]}
                size="sm"
                maxUsers={3}
                suppressClick
              />
              <span class="text-sm text-ink">Some content here</span>
            </div>
          </div>

          {/* With the fix */}
          <div class="flex items-center gap-4">
            <span class="text-xs text-ink-extra-muted font-mono w-24">
              with fix
            </span>
            <div class="flex items-center gap-2 px-3 py-2 rounded hover:bg-hover hover:[--avatar-group-separator:var(--color-hover)] transition-colors border border-edge-muted">
              <UserGroup
                userIds={[...USER_IDS]}
                size="sm"
                maxUsers={3}
                suppressClick
              />
              <span class="text-sm text-ink">Some content here</span>
            </div>
          </div>
        </div>
      </Section>

      {/* Active/selected state test */}
      <Section title="Active State Test">
        <div class="space-y-2">
          <div class="flex items-center gap-2 px-3 py-2 rounded bg-active [--avatar-group-separator:var(--color-active)] border border-edge-muted">
            <UserGroup
              userIds={[...USER_IDS]}
              size="sm"
              maxUsers={3}
              suppressClick
            />
            <span class="text-sm text-ink">
              Active row with matching separator
            </span>
          </div>

          <div class="flex items-center gap-2 px-3 py-2 rounded bg-hover [--avatar-group-separator:var(--color-hover)] border border-edge-muted">
            <UserGroup
              userIds={[...USER_IDS]}
              size="sm"
              maxUsers={3}
              suppressClick
            />
            <span class="text-sm text-ink">
              Hover row with matching separator
            </span>
          </div>
        </div>
      </Section>

      {/* Email-only fallback */}
      <Section title="Email Fallback (no macro ID)">
        <div class="flex items-center gap-3">
          <UserIcon email="john@example.com" size="sm" suppressClick />
          <UserIcon email="jane@example.com" size="md" suppressClick />
          <UserIcon email="bob@example.com" size="lg" suppressClick />
        </div>
      </Section>

      {/* Deleted state */}
      <Section title="Deleted User State">
        <div class="flex items-center gap-3">
          <For each={SIZE_LABELS}>
            {(size) => (
              <UserIcon
                id={MOCK_USERS[0].id}
                size={size}
                isDeleted
                suppressClick
              />
            )}
          </For>
        </div>
      </Section>
    </div>
  );
}
