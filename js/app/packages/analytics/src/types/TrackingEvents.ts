// This file is created to store all the tracking events that are used in the application.
// Events should be actions that are performed by the user and should be tracked.

// Tracking Events should be defined in the following format:
// [APP_NAME]_[FEATURE_NAME]...-[ACTION_NAME]
// e.g. WEBAPP_BlockChat-Macros-Open

export const TrackingEvents = {
  SUBSCRIPTION: {
    SUCCESS: 'WEBAPP_Subscription-Success',
  },
  UPLOAD: {
    FILE: 'WEBAPP_Upload_File',
    ERROR: 'WEBAPP_Upload_Error',
  },
  PAYWALL: {
    SHOW: 'WEBAPP_Paywall-Show',
    CHAT: {
      REFER_FRIEND: 'WEBAPP_Paywall-Chat-ReferFriend',
    },
  },
  CHROME_EXTENSION: {
    SHOW: 'WEBAPP_ChromeExtension-Show',
  },
  START: {
    UPGRADE: 'WEBAPP_Start-Upgrade',
    REFERRAL: 'WEBAPP_Start-Referral',
  },
  ONBOARDING: {
    START: 'WEBAPP_Onboarding-Start',
    COMPLETE: 'WEBAPP_Onboarding-Complete',

    CREATE_ACCOUNT: {
      SSO: {
        GOOGLE: {
          AUTH_START: 'WEBAPP_Onboarding-CreateAccount-SSO-Google-AuthStart',
          AUTH_SUCCESS: 'WEBAPP_Onboarding-CreateAccount-SSO-Google-AuthSucces',
          AUTH_FAILURE:
            'WEBAPP_Onboarding-CreateAccount-SSO-Google-AuthFailure',
        },
      },
    },

    GMAIL: {
      CONNECT_START: 'WEBAPP_Onboarding-Gmail-ConnectStart',
      CONNECT_SUCCESS: 'WEBAPP_Onboarding-Gmail-ConnectSuccess',
      CONNECT_FAILURE: 'WEBAPP_Onboarding-Gmail-ConnectFailure',
      // SKIP: 'WEBAPP_Onboarding-Gmail-Skip',
    },
    SUBSCRIBE: {
      CHECKOUT_START: 'WEBAPP_Onboarding-Subscribe-CheckoutStart',
      CHECKOUT_SUCCESS: 'WEBAPP_Onboarding-Subscribe-CheckoutSuccess',
      CHECKOUT_FAILURE: 'WEBAPP_Onboarding-Subscribe-CheckoutFailure',
    },

    // NOT CURRENTLY USED:
    // UPLOAD: 'WEBAPP_Onboarding-Upload',
    // NEXT_STEP: 'WEBAPP_Onboarding-NextStep',
    // PREV_STEP: 'WEBAPP_Onboarding-PrevStep',
    // ADD_MACRO: 'WEBAPP_Onboarding-AddMacro',
    // REMOVE_MACRO: 'WEBAPP_Onboarding-RemoveMacro',
    // SUGGESTIONS_GENERATED: 'WEBAPP_Onboarding-SuggestionsGenerated',
    // SUGGESTIONS_ERROR: 'WEBAPP_Onboarding-SuggestionsError',

    // SHORTCUTS: {
    //   PRACTICE: 'WEBAPP_Onboarding-Shortcuts-Practice',
    //   COMPLETE: 'WEBAPP_Onboarding-Shortcuts-Complete',
    //   SKIP: 'WEBAPP_Onboarding-Shortcuts-Skip',
    // },

    // FILE: {
    //   ADD: 'WEBAPP_Onboarding-File-Add',
    //   REMOVE: 'WEBAPP_Onboarding-File-Remove',
    //   SKIP: 'WEBAPP_Onboarding-File-Skip',
    // },
    // COMMUNITY: {
    //   NEWSLETTER_SUBSCRIBE: 'WEBAPP_Onboarding-Community-NewsletterSubscribe',
    //   NEWSLETTER_UNSUBSCRIBE:
    //     'WEBAPP_Onboarding-Community-NewsletterUnsubscribe',
    //   TWITTER_CLICK: 'WEBAPP_Onboarding-Community-TwitterClick',
    //   DISCORD_CLICK: 'WEBAPP_Onboarding-Community-DiscordClick',
    //   SKIP: 'WEBAPP_Onboarding-Community-Skip',
    // },
  },
  AUTH: {
    START: 'WEBAPP_Auth-Start',
    TERMINATE: 'WEBAPP_Auth-Terminate',
    LOGIN: 'WEBAPP_Auth-Login',
    LOGOUT: 'WEBAPP_Auth-Logout',
  },
  SHARE: {
    OPEN: 'WEBAPP_Share-Open',
    CLOSE: 'WEBAPP_Share-Close',
    EMBED: 'WEBAPP_Share-Embed',
    FORWARD: 'WEBAPP_Share-Forward',
  },
  SETTINGS: {
    OPEN: 'WEBAPP_Settings-Open',
    CLOSE: 'WEBAPP_Settings-Close',
    CHANGETAB: 'WEBAPP_Settings-ChangeTab',
  },

  RIGHTBAR: {
    OPEN: 'WEBAPP_Rightbar-Open',
    CLOSE: 'WEBAPP_Rightbar-Close',
    NEW: 'WEBAPP_Rightbar-New',
  },
  CHAT: {
    OPEN: 'WEBAPP_Chat-Open',
    ATTACHMENT: {
      ADD: 'WEBAPP_Chat-Attachment-Add',
      REMOVE: 'WEBAPP_Chat-Attachment-Remove',
      DROP: 'WEBAPP_Chat-Attachment-Drop',
      MENU: {
        OPEN: 'WEBAPP_Chat-AttachmentMenu-Open',
        CLOSE: 'WEBAPP_Chat-AttachmentMenu-Close',
        SELECT: 'WEBAPP_Chat-AttachmentMenu-Select',
      },
    },
    MENTION: {
      SELECT: 'WEBAPP_Chat-Mention-Select',
    },
    MESSAGE: {
      SEND: 'WEBAPP_Chat-Message-Send',
      STOP: 'WEBAPP_Chat-Message-Stop',
    },
    MODEL: {
      OPEN: 'WEBAPP_Chat-Model-Open',
      CLOSE: 'WEBAPP_Chat-Model-Close',
      SELECT: 'WEBAPP_Chat-Model-Select',
    },
  },
  BLOCKCHAT: {
    OPEN: 'WEBAPP_BlockChat-Open',
    CHATMENU: {
      SHARE: 'WEBAPP_BlockChat-ChatMenu-Share',
      DELETE: 'WEBAPP_BlockChat-ChatMenu-Delete',
      COPY: 'WEBAPP_BlockChat-ChatMenu-Copy',
      FAVORITE: 'WEBAPP_BlockChat-ChatMenu-Favorite',
    },
  },
  POPUP: {
    HIGHLIGHT: {
      ADD: 'WEBAPP_Popup-Highlight-Add',
      REMOVE: 'WEBAPP_Popup-Highlight-Remove',
    },
    ASKAI: {
      OPEN: 'WEBAPP_Popup-ASKAI-Open',
      SELECT: 'WEBAPP_Popup-ASKAI-Select',
      CLOSE: 'WEBAPP_Popup-ASKAI-Close',
      REFERENCE_IN_CHAT: 'WEBAPP_Popup-ASKAI-ReferenceInChat',
    },
  },
  BLOCKPDF: {
    OPEN: 'WEBAPP_BlockPDF-Open',
    FILEMENU: {
      OPEN: 'WEBAPP_BlockPDF-FileMenu-Open',
      CLOSE: 'WEBAPP_BlockPDF-FileMenu-Close',

      PRINT: 'WEBAPP_BlockPDF-FileMenu-Print',
      SHARE: 'WEBAPP_BlockPDF-FileMenu-Share',
      DOWNLOAD: 'WEBAPP_BlockPDF-FileMenu-Download',
      FAVORITE: 'WEBAPP_BlockPDF-FileMenu-Favorite',
      COPY: 'WEBAPP_BlockPDF-FileMenu-Copy',
      DELETE: 'WEBAPP_BlockPDF-FileMenu-Delete',
    },

    COMMENT: {
      CREATE: 'WEBAPP_BlockPDF-Comment-Create',
      UPDATE: 'WEBAPP_BlockPDF-Comment-Update',
      DELETE: 'WEBAPP_BlockPDF-Comment-Delete',
    },

    DEFINITION: {
      OPEN: 'WEBAPP_BlockPDF-Definition-Open',
      // CLOSE: 'WEBAPP_BlockPDF-Definition-Close',
    },

    SECTION: {
      OPEN: 'WEBAPP_BlockPDF-Section-Open',
      // CLOSE: 'WEBAPP_BlockPDF-Section-Close',
    },

    PERMISSIONS: {
      UPDATE: 'WEBAPP_BlockPDF-Permissions-Update',
    },
  },
  BLOCKWRITER: {
    OPEN: 'WEBAPP_BlockWriter-Open',
    FILEMENU: {
      PRINT: 'WEBAPP_BlockWriter-FileMenu-Print',
      SHARE: 'WEBAPP_BlockWriter-FileMenu-Share',
      DOWNLOAD: 'WEBAPP_BlockWriter-FileMenu-Download',
      CONVERT: 'WEBAPP_BlockWriter-FileMenu-Convert',
      FAVORITE: 'WEBAPP_BlockWriter-FileMenu-Favorite',
      COPY: 'WEBAPP_BlockWriter-FileMenu-Copy',
      DELETE: 'WEBAPP_BlockWriter-FileMenu-Delete',
    },
    FORMATMENU: {
      TEXTALIGN: {
        LEFT: 'WEBAPP_BlockWriter-FormatMenu-TextAlign-Left',
        CENTER: 'WEBAPP_BlockWriter-FormatMenu-TextAlign-Center',
        RIGHT: 'WEBAPP_BlockWriter-FormatMenu-TextAlign-Right',
        JUSTIFY: 'WEBAPP_BlockWriter-FormatMenu-TextAlign-Justify',
      },
      FONT: 'WEBAPP_BlockWriter-FormatMenu-Font',
      FONTSIZE: {
        CHANGE: 'WEBAPP_BlockWriter-FormatMenu-FontSize-Change',
        GROW: 'WEBAPP_BlockWriter-FormatMenu-FontSize-Grow',
        SHRINK: 'WEBAPP_BlockWriter-FormatMenu-FontSize-Shrink',
      },
      FONTCOLOR: 'WEBAPP_BlockWriter-FormatMenu-FontColor',
      PARAGRAPH: 'WEBAPP_BlockWriter-FormatMenu-Paragraph',
      TEXTDECORATION: 'WEBAPP_BlockWriter-FormatMenu-TextDecoration',
      BULLETPOINT: 'WEBAPP_BlockWriter-FormatMenu-BulletPoint',
      CHECKBOX: 'WEBAPP_BlockWriter-FormatMenu-Checkbox',
      TRACKCHANGES: 'WEBAPP_BlockWriter-FormatMenu-TrackChanges',
    },
    COMMENTS: {
      CREATE: 'WEBAPP_BlockWriter-Comments-Create',
      EDIT: 'WEBAPP_BlockWriter-Comments-Edit',
      RESOLVE: 'WEBAPP_BlockWriter-Comment-Resolve',
      DELETE: 'WEBAPP_BlockWriter-Comment-Delete',
      REPLY: {
        CREATE: 'WEBAPP_BlockWriter-Comment-Reply-Create',
        EDIT: 'WEBAPP_BlockWriter-Comment-Reply-Edit',
        RESOLVE: 'WEBAPP_BlockWriter-Comment-Reply-Resolve',
        DELETE: 'WEBAPP_BlockWriter-Comment-Reply-Delete',
      },
    },
  },
  BLOCKCANVAS: {
    OPEN: 'WEBAPP_BlockCanvas-Open',
    FILEMENU: {
      DOWNLOAD: 'WEBAPP_BlockCanvas-FileMenu-Download',
      SHARE: 'WEBAPP_BlockCanvas-FileMenu-Share',
    },
    PERMISSIONS: {
      UPDATE: 'WEBAPP_BlockCanvas-Permissions-Update',
    },
    IMAGES: {
      STATICIMAGE: 'WEBAPP_BlockCanvas-Dropdown-Static-Image',
      DSSIMAGE: 'WEBAPP_BlockCanvas-Dropdown-DSS-Image',
      STATICFAILURE: 'WEBAPP_BlockCanvas-Static-Image-Error',
    },
    VIDEOS: {
      STATICVIDEO: 'WEBAPP_BlockCanvas-Dropdown-Static-Video',
      DSSVIDEO: 'WEBAPP_BlockCanvas-Dropdown-DSS-Video',
      STATICFAILURE: 'WEBAPP_BlockCanvas-Static-Video-Error',
    },
    FILES: {
      SIDEBARDND: 'WEBAPP_BlockCanvas-Sidebar-Drag-And-Drop',
      OPENFILESIDE: 'WEBAPP_BlockCanvas-Filenode-Sidepeek',
    },
    RESETZOOM: 'WEBAPP_BlockCanvas-ResetZoom',
  },
  BLOCKEMAIL: {
    OPEN: 'BlockEmail-Open',
  },
  BLOCKIMAGE: {
    OPEN: 'WEBAPP_BlockImage-Open',
    FILEMENU: {
      SAVE: 'WEBAPP_BlockImage-FileMenu-Save',
      DOWNLOAD: 'WEBAPP_BlockImage-FileMenu-Download',
      RENAME: 'WEBAPP_BlockImage-FileMenu-Rename',
      SHARE: 'WEBAPP_BlockImage-FileMenu-Share',
      FAVORITE: 'WEBAPP_BlockImage-FileMenu-Favorite',
      DELETE: 'WEBAPP_BlockImage-FileMenu-Delete',
    },
    PERMISSIONS: {
      UPDATE: 'WEBAPP_BlockImage-Permissions-Update',
    },
  },
  BLOCKCODE: {
    OPEN: 'WEBAPP_BlockCode-Open',
    FILEMENU: {
      SAVE: 'WEBAPP_BlockCode-FileMenu-Save',
      DOWNLOAD: 'WEBAPP_BlockCode-FileMenu-Download',
      RENAME: 'WEBAPP_BlockCode-FileMenu-Rename',
      SHARE: 'WEBAPP_BlockCode-FileMenu-Share',
    },
    PERMISSIONS: {
      UPDATE: 'WEBAPP_BlockCode-Permissions-Update',
    },
  },
  BLOCKMARKDOWN: {
    OPEN: 'WEBAPP_BlockMarkdown-Open',
    FILEMENU: {
      RENAME: 'WEBAPP_BlockMarkdown-FileMenu-Rename',
      SHARE: 'WEBAPP_BlockMarkdown-FileMenu-Share',
      FAVORITE: 'WEBAPP_BlockMarkdown-FileMenu-Favorite',
      COPY: 'WEBAPP_BlockMarkdown-FileMenu-Copy',
      DELETE: 'WEBAPP_BlockMarkdown-FileMenu-DELETE',
      DOWNLOAD: 'WEBAPP_BlockMarkdown-FileMenu-Download',
    },
    COMMENT: {
      CREATE: 'WEBAPP_BlockMarkdown-Comment-Create',
      UPDATE: 'WEBAPP_BlockMarkdown-Comment-Update',
      DELETE: 'WEBAPP_BlockMarkdown-Comment-Delete',
    },
  },
  ORGANIZATION: {
    SETTINGS: {
      PERMISSIONS: 'WEBAPP_Organization-Settings-Permissions',
      ACCESSLEVEL: 'WEBAPP_Organization-Settings-AccessLevel',
      RETENTION: 'WEBAPP_Organization-Settings-Retention',
    },
    MEMBERS: {
      INVITE: 'WEBAPP_Organization-Members-Invite',
      REVOKE: 'WEBAPP_Organization-Members-Revoke',
      DELETE: 'WEBAPP_Organization-Members-Delete',
      UPDATE: 'WEBAPP_Organization-Members-Update',
    },
  },
  BLOCKCHANNEL: {
    MESSAGE: {
      SEND: 'WEBAPP_BlockChannel-Message-Send',
      REACTION: 'WEBAPP_BlockChannel-Message-Reaction',
    },
    PARTICIPANT: {
      ADD: 'WEBAPP_BlockChannel-Participant-Add',
      REMOVE: 'WEBAPP_BlockChannel-Participant-Remove',
    },
    CHANNEL: {
      OPEN: 'WEBAPP_BlockChannel-Channel-Open',
      CREATE: 'WEBAPP_BlockChannel-Channel-Create',
      DELETE: 'WEBAPP_BlockChannel-Channel-Delete',
      LEAVE: 'WEBAPP_BlockChannel-Channel-Leave',
    },
    ATTACHMENT: {
      DRAG: 'WEBAPP_BlockChannel-Attachment-Dragged',
    },
  },
  BLOCKUNKNOWN: {
    OPEN: 'WEBAPP_BlockUnknown-Open',
  },
  BLOCKVIDEO: {
    OPEN: 'WEBAPP_BlockVideo-Open',
    PLAYBACK: {
      ERROR: 'WEBAPP_BlockVideo-Playback-Error',
    },
  },
  CONSOLE: {
    WARN: 'WEBAPP_Console-Warn',
    ERROR: 'WEBAPP_Console-Error',
  },
} as const;

type ExtractValues<T> = T extends object ? ExtractValues<T[keyof T]> : T;
export type AllTrackingEventValues = ExtractValues<typeof TrackingEvents>;
