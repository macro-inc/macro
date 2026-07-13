/**
 * Payload shared by the generic entity lifecycle events (`create_entity`,
 * `update_entity`, `delete_entity`, `share_entity`).
 *
 * Only the identifying fields are structured; any event-specific context
 * (e.g. `hasDueDate` on task creation, `newProjectId` on a move) rides along
 * as unstructured extra properties instead of minting a new event type.
 */
export type EntityEventPayload = {
  /**
   * Coarse entity/block type: 'md' | 'task' | 'snippet' | 'code' | 'canvas' |
   * 'chat' | 'project' | 'channel' | 'email' | 'document' | ... Open-ended on
   * purpose — different layers know the entity at different granularities.
   */
  entityType: string;
  entityId?: string;
  /** UI surface the action originated from (e.g. 'launcher', 'mobile_dock'). */
  source?: string;
} & Record<string, unknown>;

export type AppEvents = {
  // --- Acquisition & auth -------------------------------------------------
  /**
   * Account creation, browser side (GA only). The authoritative PostHog
   * `sign_up` is emitted server-side from the create-user webhook; the
   * browser fires this GA event plus the ad conversions when the backend
   * flags the session via the `signed_up=true` redirect param. See
   * signupCompletion.ts.
   */
  sign_up: Record<string, unknown>;
  /** Signup intent: user clicked a sign-up CTA (pre-redirect, may not convert). */
  sign_up_click: { method?: string } & Record<string, unknown>;
  login: Record<string, unknown>; // payload - include link status
  sign_out: Record<string, unknown>;
  login_from_onboarding: Record<string, unknown>;
  mobile_web_welcome_viewed: Record<string, unknown>;
  mobile_web_signup_sent_viewed: Record<string, unknown>;

  // --- Interactive tutorial (optional; decoupled from acquisition) ---------
  tutorial_started: { isFirstTime: boolean };
  tutorial_step: {
    id: string;
    index: number;
    state: 'viewed' | 'completed' | 'skipped';
  };
  tutorial_completed: { isFirstTime: boolean };
  tutorial_skipped: Record<string, unknown>;

  subscription_start: Record<string, unknown>;
  subscription_cancel: Record<string, unknown>;
  subscription_success: Record<string, unknown>;

  sidebar_click: Record<string, unknown>;
  notifications_toggled: Record<string, unknown>;

  share_menu_open: { blockType: string };

  copy_share_link: Record<string, unknown>;
  download: Record<string, unknown>;
  comment_create: { blockType: string };
  comment_update: { blockType: string };
  comment_delete: { blockType: string };
  upload_file: {
    fileType?: string;
    fileName?: string;
    fileSize?: number;
    destination: 'dss' | 'static';
    folder?: boolean;
  };
  upload_error: {
    type: string;
    destination?: 'dss' | 'static';
  };

  command_menu_open: { from: string };
  command_menu_use: { itemType: string };
  create_menu_open: { from: string };
  hotkey_use: Record<string, unknown>;
  preview_panel_use: Record<string, unknown>;
  mentions_menu_use: { itemType: string };
  snippets_menu_use: Record<string, unknown>;
  split_created: { from: string };

  // --- Entity lifecycle ----------------------------------------------------
  // Fired at data-layer chokepoints (core/util/create.ts, FileList
  // itemOperations, property-save mutations, share/forward flows, BlockLoader)
  // so every UI surface is covered without per-surface instrumentation.
  /**
   * An entity was opened in a split (md, task, pdf, chat, email, channel,
   * canvas, code, project, company, contact, ...). Fired from BlockLoader on
   * successful load; nested blocks and preview-panel peeks are excluded.
   */
  open_entity: EntityEventPayload;
  /**
   * A top-level view was opened (soup list views like inbox/mail/documents/
   * tasks/channels, plus home, search, and the compose views). Fired from the
   * split-layout component registry.
   */
  open_view: { viewId: string } & Record<string, unknown>;
  create_entity: EntityEventPayload;
  update_entity: EntityEventPayload & {
    /** Which property changed: 'name' | 'parent_project' | 'status' | ... */
    property: string;
  };
  delete_entity: EntityEventPayload & { deleteType?: 'soft' | 'permanent' };
  share_entity: EntityEventPayload & {
    shareMethod?:
      | 'public_link'
      | 'channel'
      | 'forward'
      | 'attachment_public'
      | (string & {});
  };

  task_copy_branch_name: Record<string, unknown>;

  theme_changed: { themeId: string };

  ai_message_sent: Record<string, unknown>;
  ai_attachment_add: Record<string, unknown>;

  email_message_sent: Record<string, unknown>;

  channel_message_sent: Record<string, unknown>;
  channel_reaction: {
    emoji: string;
    action: 'add' | 'remove';
  };

  // --- Calls ---------------------------------------------------------------
  // Frontend call interactions. Authoritative lifecycle (ended, recording,
  // summary) is server-driven and tracked backend-side.
  call_action: {
    action:
      | 'join_clicked'
      | 'started'
      | 'joined'
      | 'left'
      | 'screen_share_toggled';
    channelId: string;
    callId?: string;
  } & Record<string, unknown>;
  // Mic audio-processing state transitions (noise suppression attach /
  // detach / fallback). `constraintMismatch` flags engines that report
  // different track settings than were requested (mode changes that silently
  // no-oped); `sampleRate` <= 16000 indicates a Bluetooth HFP capture path.
  call_audio_processing: {
    event: string;
    channelId: string;
    preferredMode: string;
    activeMode: string;
    constraintMismatch: boolean;
  } & Record<string, unknown>;
  // Per-call summary of remote-audio decode health, flushed at room teardown.
  // High concealment alongside clean capture-side state points a "muddled
  // voices" report at the network/playback leg, not noise suppression.
  call_audio_receiver_stats: {
    channelId: string;
    callId?: string;
    sampledIntervals: number;
    badIntervals: number;
    maxConcealmentRate: number;
  } & Record<string, unknown>;

  block_pdf_definition_open: Record<string, unknown>;
  block_pdf_section_open: Record<string, unknown>;
};

export type AppEventNames = keyof AppEvents;
