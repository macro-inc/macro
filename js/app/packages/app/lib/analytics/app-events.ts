export type AppEvents = {
  sign_up: Record<string, unknown>; // payload - include link status
  sign_out: Record<string, unknown>;
  login: Record<string, unknown>; // payload - include link status
  onboarding_start: Record<string, unknown>;
  onboarding_step: Record<string, unknown>; // payload -
  onboarding_completed: Record<string, unknown>;
  login_from_onboarding: Record<string, unknown>;
  mobile_web_welcome_viewed: Record<string, unknown>;
  mobile_web_signup_sent_viewed: Record<string, unknown>;
  onboarding_team_created: { inviteCount: number };
  onboarding_team_skipped: Record<string, unknown>;

  subscription_start: Record<string, unknown>;
  subscription_cancel: Record<string, unknown>;
  subscription_success: Record<string, unknown>;

  sidebar_click: Record<string, unknown>;
  notifications_toggled: Record<string, unknown>;

  references_panel_open: { blockType: string };
  notifications_panel_open: { blockType: string };
  properties_panel_open: { blockType: string };
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
  split_created: { from: string };

  share_entity: Record<string, unknown>; // payload - entity type, location
  create_entity: Record<string, unknown>; // payload - entity type
  delete_entity: Record<string, unknown>; // payload - entity type
  update_entity: Record<string, unknown>; // payload - properties updated and entity type

  task_copy_branch_name: Record<string, unknown>;

  search: Record<string, unknown>;

  theme_changed: { themeId: string };

  ai_message_sent: Record<string, unknown>;
  ai_attachment_add: Record<string, unknown>;

  email_authorized: Record<string, unknown>;
  email_unauthorized: Record<string, unknown>;
  email_message_sent: Record<string, unknown>;

  channel_message_sent: Record<string, unknown>;
  channel_reaction: {
    emoji: string;
    action: 'add' | 'remove';
  };
  channel_participant_add: Record<string, unknown>;
  channel_participant_remove: Record<string, unknown>;

  block_pdf_definition_open: Record<string, unknown>;
  block_pdf_section_open: Record<string, unknown>;
};

export type AppEventNames = keyof AppEvents;
