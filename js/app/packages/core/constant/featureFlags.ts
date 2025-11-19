/**
 * This constant reflects whether the app is running locally with hot reload enabled
 *
 * @returns true in bun run dev, false otherwise
 */
export const LOCAL_ONLY = !!import.meta.hot;

/**
 * This constant reflects whether the app is running in development mode with dev backend environment
 *
 * @returns true in dev.macro.com and bun run dev, false otherwise
 */
export const DEV_MODE_ENV = import.meta.env.MODE === 'development';

/**
 * This constant reflects whether the app is running in production mode with prod backend environment
 *
 * @returns true in macro.com, false otherwise
 */
export const PROD_MODE_ENV = import.meta.env.MODE === 'production';

export const ENABLE_FORM_EDITING = false;

export const ENABLE_PDF_MODIFICATION_DATA_AUTOSAVE = true;

export const ENABLE_PDF_LOCATION_AUTOSAVE = true;

// TODO: fix highlights when pane pins are enabled
// See HighlightCard component for more details
export const ENABLE_PINS = false;

export const ENABLE_THUMBNAIL_VIEWER = false;

export const EDITOR_TOPBAR_BOOKMARKS = false;

export const ENABLE_PDF_TABS = true;

export const ENABLE_PDF_MARKUP = true;

export const ENABLE_MACROTATIONS = false;

// TODO: rename this, this only applies to writer block at the moment
export const ENABLE_MACROTATIONS_PANEL = false;

export const ENABLE_INBOX = true;

export const ENABLE_MARKDOWN_BLOCK = true;

export const ENABLE_CANVAS_BLOCK = true;

// NOTE: disabling scripting: event listener needs to be properly unmounted first
// this is the offending line in our pdfjs repo, which has been fixed in the upstream
// https://github.com/macro-inc/pdf.js/blob/d22768d78ebaaf038707d3d926992a7aeb88e730/web/pdf_scripting_manager.js?plain=1#L59
export const ENABLE_SCRIPTING = false;

export const ENABLE_ONBOARDING = true;

export const ENABLE_PDF_MULTISPLIT = true;

export const ENABLE_CHAT_INITIALIZER = true;

export const ENABLE_CITATIONS = true;

export const ENABLE_CONNECTION_POPUP = DEV_MODE_ENV;

export const ENABLE_PROJECT_SHARING = DEV_MODE_ENV;

export const ENABLE_CHAT_CREATE_TYPE_DROPDOWN = DEV_MODE_ENV;

export const ENABLE_CANVAS_IMAGES = true;

export const ENABLE_CANVAS_FILES = true;

export const ENABLE_CANVAS_TEXT = true;

export const ENABLE_ORG_SETTING_DEFAULT_SHARE = false;

export const ENABLE_SEPARATE_NOTIFICATION_STACKS = true;

export const ENABLE_NAME_IN_LOGIN = false;

export const ENABLE_LIVE_INDICATORS = true;

export const EXPERIMENTAL_DARK_MODE = true;

export const ENABLE_MINDMAP = true;

export const ENABLE_CONTACTS = true;
export const ENABLE_GMAIL_BASED_CONTACTS = DEV_MODE_ENV;

export const ENABLE_PROFILE_PICTURES = true;

export const ENABLE_FOLDER_UPLOAD = true;

export const ENABLE_VIDEO_BLOCK = true;

export const ENABLE_DOCX_TO_PDF = true;

export const ENABLE_MARKDOWN_LIVE_COLLABORATION = true;

export const ENABLE_EMAIL = true;

export const ENABLE_BLOCK_IN_BLOCK = true;

export const ENABLE_AI_MEMORY = true;

export const EDITABLE_SMART_INSIGHTS = false;

export const ENABLE_SEARCH_SERVICE = true;

export const ENABLE_MARKDOWN_DIFF = true;

export const ENABLE_HISTORY_COMPONENT = true;

export const ENABLE_BEARER_TOKEN_AUTH = false;

export const ENABLE_MARKDOWN_SEARCH_TEXT = DEV_MODE_ENV;

export const CANVAS_SVG_IMPORT = true;

export const ENABLE_CANVAS_VIDEO = true;

// TODO: figure out why the image does not load into canvas after upload
export const ENABLE_CANVAS_HEIC = false;

// TODO - comments are not stable in markdown multiplayer, they will need more work.
export const ENABLE_MARKDOWN_COMMENTS = true;

export const ENABLE_REFERENCES_MODAL = true;

export const ENABLE_MENTION_TRACKING = true;

export const ENABLE_SEARCH_PAGINATION = true;

export const ENABLE_CHAT_CHANNEL_ATTACHMENT = true;

// NOTE: shows a websocket debug panel that lets you toggle state on dcs/connection websockets
export const ENABLE_WEBSOCKET_DEBUGGER = false;

export const ENABLE_SVG_PREVIEW = true;

export const USE_PIXEL_BLOCK_ICONS = false;

export const ENABLE_PROPERTIES_METADATA = DEV_MODE_ENV;

export const ENABLE_EMAIL_VIEW = true;

// TODO: re-enable when supported in backend
export const ENABLE_SOUP_FROM_FILTER = false;

export const ENABLE_PREVIEW = true;

export const ENABLE_DOCK_NOTITIFCATIONS = DEV_MODE_ENV;
export const ENABLE_TTFT = DEV_MODE_ENV;

export const ENABLE_CUSTOM_CURSOR = false;
