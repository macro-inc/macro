import { EntityIcon, type EntityIconProps } from '@core/component/EntityIcon';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { Resize } from '@core/component/Resize/Resize';
import { Bar } from '@core/component/TopBar/Bar';
import XIcon from '@icon/regular/x.svg';
import AddIcon from '@macro-icons/pixel/add.svg';
import { nanoid } from 'nanoid';
import { createSignal, For, type ParentProps } from 'solid-js';

function PanelCard(
  props: ParentProps<{
    title: string;
    entityType: EntityIconProps['targetType'];
    markdown: string;
    onClickAddPanel?: () => void;
    onClickRemove?: () => void;
    index: number;
    id: string;
  }>
) {
  return (
    <div
      class="size-full bg-panel flex overflow-hidden flex-col border border-edge focus-within:border-accent -ring-offset-2 focus-within:ring-2 focus-within:ring-accent group"
      id={props.id}
    >
      <div class="bg-edge flex-0 p-2 text-ink flex items-center justify-between group-focus-within:bg-accent group-focus-within:text-panel">
        <div class="flex items-center gap-2">
          <EntityIcon targetType={props.entityType} theme="monochrome" />

          <div class="font-mono">
            [{props.index}-{props.id}]
          </div>
          <div class="truncate">{props.title}</div>
        </div>
        <div class="flex items-center gap-1">
          {props.onClickAddPanel && (
            <button
              onClick={props.onClickAddPanel}
              class="p-1 rounded hover:bg-accent/10 group-focus-within:hover:bg-accent/10"
              title="Add panel"
            >
              <AddIcon class="size-4" />
            </button>
          )}
          {props.onClickRemove && (
            <button
              onClick={props.onClickRemove}
              class="p-1 rounded hover:bg-accent/10 group-focus-within:hover:bg-accent/10"
              title="Remove panel"
            >
              <XIcon class="size-4" />
            </button>
          )}
        </div>
      </div>
      <div class="grow-1 p-2 overflow-auto">
        <MarkdownTextarea
          initialValue={props.markdown}
          editable={() => true}
          focusOnMount={true}
        />
      </div>
    </div>
  );
}

function VerticalPanelCard(
  props: ParentProps<{
    title: string;
    entityType: EntityIconProps['targetType'];
    markdownTop: string;
    markdownBottom: string;
    onClickAddPanel?: () => void;
    onClickRemove?: () => void;
    index: number;
    id: string;
  }>
) {
  return (
    <div
      class="size-full bg-panel flex overflow-hidden flex-col border border-edge focus-within:border-accent -ring-offset-2 focus-within:ring-2 focus-within:ring-accent group"
      id={props.id}
    >
      <div class="bg-edge flex-0 p-2 text-ink flex items-center justify-between group-focus-within:bg-accent group-focus-within:text-panel">
        <div class="flex items-center gap-2">
          <EntityIcon targetType={props.entityType} theme="monochrome" />
          <div class="font-mono">
            [{props.index}-{props.id}] VERTICAL
          </div>
          <div class="truncate">{props.title}</div>
        </div>
        <div class="flex items-center gap-1">
          {props.onClickAddPanel && (
            <button
              onClick={props.onClickAddPanel}
              class="p-1 rounded hover:bg-accent/10 group-focus-within:hover:bg-accent/10"
              title="Add panel"
            >
              <AddIcon class="size-4" />
            </button>
          )}
          {props.onClickRemove && (
            <button
              onClick={props.onClickRemove}
              class="p-1 rounded hover:bg-accent/10 group-focus-within:hover:bg-accent/10"
              title="Remove panel"
            >
              <XIcon class="size-4" />
            </button>
          )}
        </div>
      </div>
      <div class="grow-1 overflow-hidden">
        <Resize.Zone gutter={0} direction="vertical">
          <Resize.Panel id={`${props.id}-top`} minSize={100}>
            <div class="size-full p-2 overflow-auto border-b border-edge">
              <div class="text-xs text-ink/60 mb-2">TOP SECTION</div>
              <MarkdownTextarea
                initialValue={props.markdownTop}
                editable={() => true}
                focusOnMount={false}
              />
            </div>
          </Resize.Panel>
          <Resize.Panel id={`${props.id}-bottom`} minSize={100}>
            <div class="size-full p-2 overflow-auto">
              <div class="text-xs text-ink/60 mb-2">BOTTOM SECTION</div>
              <MarkdownTextarea
                initialValue={props.markdownBottom}
                editable={() => true}
                focusOnMount={false}
              />
            </div>
          </Resize.Panel>
        </Resize.Zone>
      </div>
    </div>
  );
}

// Array of panel configurations - half will be vertical, half regular
const configs = [
  {
    title: 'Project Roadmap',
    entityType: 'project' as const,
    markdown:
      '# Project Roadmap\n\n- Q1: Core features\n- Q2: User testing\n- Q3: Performance optimization',
    markdownTop: '# Roadmap Overview\n\nStrategic planning for 2024',
    markdownBottom:
      '## Key Milestones\n\n- ✅ MVP Launch\n- 🔄 Beta Testing\n- ⏳ Public Release',
    hasVertical: false,
  },
  {
    title: 'Team Chat & Notes',
    entityType: 'channel' as const,
    markdown:
      "# Team Discussion\n\n**@john**: Hey team, how's the progress on the new feature?\n\n**@sarah**: Almost done with the UI components!",
    markdownTop:
      '# Live Chat\n\n**@alice**: Morning everyone! 👋\n**@bob**: Ready for standup?',
    markdownBottom:
      '# Meeting Notes\n\n## Action Items\n- [ ] Review PR #123\n- [ ] Update docs',
    hasVertical: true,
  },
  {
    title: 'API Documentation',
    entityType: 'md' as const,
    markdown:
      '# REST API Guide\n\n## Authentication\nUse Bearer tokens for all requests.\n\n```\nAuthorization: Bearer <token>\n```',
    markdownTop: '# API Reference\n\n## Endpoints\n\n### Authentication',
    markdownBottom:
      '## Examples\n\n```curl\ncurl -H "Authorization: Bearer token" /api/users\n```',
    hasVertical: false,
  },
  {
    title: 'Bug Report & Analysis',
    entityType: 'canvas' as const,
    markdown:
      '# Critical Bug Report\n\n**Status**: Open\n**Priority**: High\n\nUsers experiencing login issues on mobile devices.',
    markdownTop:
      '# Bug #142\n\n**Reporter**: @user123\n**Status**: 🔴 Critical',
    markdownBottom:
      '# Investigation\n\n## Root Cause\nSession timeout on mobile\n\n## Fix\nUpdate token refresh logic',
    hasVertical: true,
  },
  {
    title: 'Design System',
    entityType: 'write' as const,
    markdown:
      '# Component Library\n\n## Colors\n- Primary: #3B82F6\n- Secondary: #6B7280\n- Success: #10B981',
    markdownTop:
      '# Design Tokens\n\n## Brand Colors\n- Primary: #3B82F6\n- Secondary: #6B7280',
    markdownBottom:
      '# Component Guidelines\n\n## Button States\n- Default\n- Hover\n- Active\n- Disabled',
    hasVertical: false,
  },
  {
    title: 'Meeting & Tasks',
    entityType: 'pdf' as const,
    markdown:
      '# Weekly Standup\n\n**Date**: March 15, 2024\n\n## Agenda\n1. Sprint review\n2. Blockers\n3. Next week planning',
    markdownTop:
      '# Standup Notes\n\n**Date**: March 15, 2024\n\n## Attendees\n- Alice, Bob, Carol',
    markdownBottom:
      '# Action Items\n\n- [ ] @alice: Fix login bug\n- [ ] @bob: Update tests\n- [ ] @carol: Review designs',
    hasVertical: true,
  },
  {
    title: 'User Feedback',
    entityType: 'chat' as const,
    markdown:
      '# Customer Reviews\n\n⭐⭐⭐⭐⭐ "Amazing product!"\n\n⭐⭐⭐⭐ "Great features, minor UI issues"\n\n⭐⭐⭐⭐⭐ "Best tool I\'ve used"',
    markdownTop: '# Recent Reviews\n\n⭐⭐⭐⭐⭐ "Love the new features!"',
    markdownBottom:
      '# Feedback Analysis\n\n## Positive\n- Easy to use\n- Great performance\n\n## Areas for improvement\n- Mobile UX',
    hasVertical: false,
  },
  {
    title: 'Database & Queries',
    entityType: 'project' as const,
    markdown:
      '# Database Design\n\n```sql\nCREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  email VARCHAR(255) UNIQUE,\n  created_at TIMESTAMP\n);\n```',
    markdownTop:
      '# Schema Design\n\n```sql\nCREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  email VARCHAR(255)\n);\n```',
    markdownBottom:
      '# Common Queries\n\n```sql\n-- Get active users\nSELECT * FROM users WHERE active = true;\n```',
    hasVertical: true,
  },
  {
    title: 'Performance Metrics',
    entityType: 'canvas' as const,
    markdown:
      '# Analytics Dashboard\n\n📈 **Page Views**: 125K\n📊 **Bounce Rate**: 32%\n⚡ **Load Time**: 2.1s\n👥 **Active Users**: 8.5K',
    markdownTop:
      '# Current Metrics\n\n📈 **Page Views**: 125K\n⚡ **Load Time**: 2.1s',
    markdownBottom:
      '# Targets & Goals\n\n🎯 **Target Load Time**: <2.0s\n🎯 **Target Bounce**: <30%',
    hasVertical: false,
  },
  {
    title: 'Code Review & Tests',
    entityType: 'md' as const,
    markdown:
      '# Pull Request #87\n\n## Changes\n- Fixed authentication bug\n- Updated user profile UI\n- Added unit tests\n\n**Status**: Approved ✅',
    markdownTop:
      '# PR #87 - Auth Fix\n\n## Changes\n- Fixed token refresh\n- Updated UI components',
    markdownBottom:
      '# Test Results\n\n✅ All tests passing\n✅ Coverage: 95%\n\n**Status**: Ready to merge',
    hasVertical: true,
  },
];

export default function ResizeDemo() {
  // Select 2-3 random configs for initial display
  const [selectedConfigs, setSelectedConfigs] = createSignal(
    configs.slice(0, 2).map((config) => ({
      ...config,
      id: nanoid(4),
    }))
  );

  const addPanel = () => {
    const availableConfigs = configs.filter(
      (config) =>
        !selectedConfigs().some((selected) => selected.title === config.title)
    );
    if (availableConfigs.length > 0) {
      const randomConfig =
        availableConfigs[Math.floor(Math.random() * availableConfigs.length)];
      setSelectedConfigs((prev) => [
        ...prev,
        { ...randomConfig, id: nanoid(4) },
      ]);
    }
  };

  const removePanel = (panelId: string) => {
    setSelectedConfigs((prev) => prev.filter((panel) => panel.id !== panelId));
  };

  return (
    <div class="h-full w-full flex-flex-col">
      <Bar
        left={
          <div class="p-2 text-sm w-2xl truncate">
            Resize Debug - Mixed Layout Test
          </div>
        }
        center={<div />}
      />
      <div class="bg-panel size-full p-2">
        <div class="h-[95%] w-full">
          <Resize.Zone gutter={8} direction="horizontal">
            <For each={selectedConfigs()}>
              {(item, i) => (
                <Resize.Panel id={item.id} minSize={250}>
                  {item.hasVertical ? (
                    <VerticalPanelCard
                      title={item.title}
                      entityType={item.entityType}
                      markdownTop={item.markdownTop}
                      markdownBottom={item.markdownBottom}
                      onClickAddPanel={addPanel}
                      onClickRemove={() => removePanel(item.id)}
                      index={i()}
                      id={item.id}
                    />
                  ) : (
                    <PanelCard
                      title={item.title}
                      entityType={item.entityType}
                      markdown={item.markdown}
                      onClickAddPanel={addPanel}
                      onClickRemove={() => removePanel(item.id)}
                      index={i()}
                      id={item.id}
                    />
                  )}
                </Resize.Panel>
              )}
            </For>
          </Resize.Zone>
        </div>
      </div>
    </div>
  );
}
