export type AppEvents = {
  sign_up: Record<string, unknown>; // payload - include link status
  sign_out: Record<string, unknown>;
  login: Record<string, unknown>; // payload - include link status
  onboarding_start: Record<string, unknown>;
  onboarding_step: Record<string, unknown>; // payload -
  onboarding_completed: Record<string, unknown>;

  subscription_start: Record<string, unknown>;
  subscription_success: Record<string, unknown>;

  page_view: Record<string, unknown>;
  sidebar_click: Record<string, unknown>;
  notifications_toggled: Record<string, unknown>;

  references_panel_open: Record<string, unknown>;
  notifications_panel_open: Record<string, unknown>;
  properties_panel_open: Record<string, unknown>;

  copy_share_link: Record<string, unknown>;
  download: Record<string, unknown>;
  comment: Record<string, unknown>;
  upload_file: Record<string, unknown>;

  command_menu_open: Record<string, unknown>;
  command_menu_use: Record<string, unknown>; // payload - selected command or item
  create_menu_open: Record<string, unknown>;
  hotkey_use: Record<string, unknown>;
  preview_panel_use: Record<string, unknown>;
  mentions_menu_use: Record<string, unknown>;
  split_created: Record<string, unknown>;

  share_entity: Record<string, unknown>; // payload - entity type, location
  create_entity: Record<string, unknown>; // payload - entity type
  delete_entity: Record<string, unknown>; // payload - entity type
  update_entity: Record<string, unknown>; // payload - properties updated and entity type

  task_copy_branch_name: Record<string, unknown>;

  search: Record<string, unknown>;

  theme_changed: Record<string, unknown>;

  ai_message_sent: Record<string, unknown>;
  ai_attachment_add: Record<string, unknown>;

  email_message_sent: Record<string, unknown>;

  channel_message_sent: Record<string, unknown>;
  channel_reaction_sent: Record<string, unknown>;
  channel_thread_reply: Record<string, unknown>;
  channel_participant_add: Record<string, unknown>;
  channel_participant_remove: Record<string, unknown>;

  block_pdf_definition_open: Record<string, unknown>;
  block_pdf_section_open: Record<string, unknown>;
};

export type AppEventNames = keyof AppEvents;
