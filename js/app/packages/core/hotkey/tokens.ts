export const TOKENS = {
  // soup
  soup: {
    openSearch: 'soup.openSearch',
    sort: 'soup.sort',
    filter: 'soup.filter',
    tabs: {
      '0': 'soup.tabs.0',
      '1': 'soup.tabs.1',
      '2': 'soup.tabs.2',
      '3': 'soup.tabs.3',
      '4': 'soup.tabs.4',
      '5': 'soup.tabs.5',
      '6': 'soup.tabs.6',
      '7': 'soup.tabs.7',
      '8': 'soup.tabs.8',
      '9': 'soup.tabs.9',
      next: 'soup.tabs.next',
      prev: 'soup.tabs.prev',
    },
  },

  // unified list
  unifiedList: {
    togglePreview: 'unifiedList.togglePreview',
    navigation: {
      parent: 'unifiedList.navigation.parent',
      child: 'unifiedList.navigation.child',
    },
  },

  // entity navigation
  entity: {
    step: {
      end: 'entity.step.end',
      start: 'entity.step.start',
    },
    select: {
      end: 'entity.select.end',
      start: 'entity.select.start',
    },
    jump: {
      home: 'entity.jump.home',
      end: 'entity.jump.end',
    },
    open: 'entity.open',
    action: {
      markDone: 'entity.action.markDone',
      delete: 'entity.action.delete',
      rename: 'entity.action.rename',
      moveToFolder: 'entity.action.moveToFolder',
      copy: 'entity.action.copy',
      copyLink: 'entity.action.copyLink',
      share: 'entity.action.share',
      copyBranchName: 'entity.action.copyBranchName',
      copyEntityId: 'entity.action.copyEntityId',
      properties: 'entity.action.properties',
      priority: 'entity.action.priority',
      status: 'entity.action.status',
      assignee: 'entity.action.assignee',
    },
  },

  // code block
  code: {
    toggleComment: 'code.toggleComment',
    escape: 'code.escape',
  },

  // global
  global: {
    createCommand: 'global.createCommand',
    commandMenu: 'global.commandMenu',
    toggleBigChat: 'global.toggleBigChat',
    toggleSidebar: 'global.toggleSidebar',
    instructions: 'global.instructions',
    searchMenu: 'global.searchMenu',
    toggleSettings: 'global.toggleSettings',
    createNewSplit: 'global.createNewSplit',
    inviteTeam: 'global.inviteTeam',
    undo: 'global.undo',
    redo: 'global.redo',
  },

  // sidebar navigation
  sidebar: {
    goToLeader: 'sidebar.goToLeader',
    goTo: {
      home: 'sidebar.goTo.home',
      inbox: 'sidebar.goTo.inbox',
      search: 'sidebar.goTo.search',
      agents: 'sidebar.goTo.agents',
      mail: 'sidebar.goTo.mail',
      documents: 'sidebar.goTo.documents',
      tasks: 'sidebar.goTo.tasks',
      channels: 'sidebar.goTo.channels',
      calls: 'sidebar.goTo.calls',
      folders: 'sidebar.goTo.folders',
    },
  },

  // email
  email: {
    nextThread: 'email.nextThread',
    previousThread: 'email.previousThread',
    send: 'email.send',
    sendAndMarkDone: 'email.sendAndMarkDone',
    archive: 'email.archive',
    reply: 'email.reply',
    replyAll: 'email.replyAll',
    forward: 'email.forward',
    previousMessage: 'email.previousMessage',
    nextMessage: 'email.nextMessage',
    cancelReply: 'email.cancelReply',
    blockSender: 'email.blockSender',
    markSenderSignal: 'email.markSenderSignal',
    markSenderNoise: 'email.markSenderNoise',
    compose: {
      edit: {
        recipients: 'email.compose.edit.recipients',
        ccRecipients: 'email.compose.edit.ccRecipients',
        bccRecipients: 'email.compose.edit.bccRecipients',
        subject: 'email.compose.edit.subject',
        message: 'email.compose.edit.message',
      },
    },
  },

  // split
  split: {
    close: 'split.close',
    goCommand: 'split.goCommand',
    goHome: 'split.goHome',
    go: {
      home: 'split.go.home',
      email: 'split.go.email',
      inbox: 'split.go.inbox',
      docs: 'split.go.docs',
      toggleRightPanel: 'split.go.toggleRightPanel',
      back: 'split.go.back',
      forward: 'split.go.forward',
    },
    showHelpDrawer: 'split.showHelpDrawer',
  },

  window: {
    close: 'window.close',
    createNewSplit: 'window.createNewSplit',
    spotlight: {
      toggle: 'split.spotlight.toggle',
      close: 'split.spotlight.close',
    },
    focusSplitRight: 'window.focusSplitRight',
    focusSplitLeft: 'window.focusSplitLeft',
  },

  // canvas
  canvas: {
    delete: 'canvas.delete',
    bringToFront: 'canvas.bringToFront',
    bringForward: 'canvas.bringForward',
    sendToBack: 'canvas.sendToBack',
    sendBackward: 'canvas.sendBackward',
    selectAll: 'canvas.selectAll',
    copy: 'canvas.copy',
    cut: 'canvas.cut',
    paste: 'canvas.paste',
    zoomIn: 'canvas.zoomIn',
    zoomOut: 'canvas.zoomOut',
    undo: 'canvas.undo',
    redo: 'canvas.redo',
    cancel: 'canvas.cancel',
    selectTool: 'canvas.selectTool',
    handTool: 'canvas.handTool',
    shapeTool: 'canvas.shapeTool',
    pencilTool: 'canvas.pencilTool',
    lineTool: 'canvas.lineTool',
    textTool: 'canvas.textTool',
    zoomInTool: 'canvas.zoomInTool',
    zoomOutTool: 'canvas.zoomOutTool',
    nudgeUp: 'canvas.nudgeUp',
    nudgeUpMore: 'canvas.nudgeUpMore',
    nudgeRight: 'canvas.nudgeRight',
    nudgeRightMore: 'canvas.nudgeRightMore',
    nudgeDown: 'canvas.nudgeDown',
    nudgeDownMore: 'canvas.nudgeDownMore',
    nudgeLeft: 'canvas.nudgeLeft',
    nudgeLeftMore: 'canvas.nudgeLeftMore',
    group: 'canvas.group',
    ungroup: 'canvas.ungroup',
    optZoom: 'canvas.optZoom',
    spaceGrab: 'canvas.spaceGrab',
    line: {
      straight: 'canvas.line.straight',
      flow: 'canvas.line.flow',
      bent: 'canvas.line.bent',
      close: 'canvas.line.close',
    },
  },

  // markdown editor
  md: {
    bold: 'md.bold',
    italic: 'md.italic',
    underline: 'md.underline',
    strikethrough: 'md.strikethrough',
    highlight: 'md.highlight',
    inlineCode: 'md.inlineCode',
    superscript: 'md.superscript',
    subscript: 'md.subscript',
    heading1: 'md.heading1',
    heading2: 'md.heading2',
    heading3: 'md.heading3',
    paragraph: 'md.paragraph',
    quote: 'md.quote',
    codeBlock: 'md.codeBlock',
    bulletList: 'md.bulletList',
    numberedList: 'md.numberedList',
    checklist: 'md.checklist',
    link: 'md.link',
    image: 'md.image',
    video: 'md.video',
    math: 'md.math',
    table: 'md.table',
    divider: 'md.divider',
  },

  // create menu
  create: {
    note: 'create.note',
    noteNewSplit: 'create.noteNewSplit',
    email: 'create.email',
    emailNewSplit: 'create.emailNewSplit',
    message: 'create.message',
    messageNewSplit: 'create.messageNewSplit',
    chat: 'create.chat',
    chatNewSplit: 'create.chatNewSplit',
    canvas: 'create.canvas',
    canvasNewSplit: 'create.canvasNewSplit',
    project: 'create.project',
    projectNewSplit: 'create.projectNewSplit',
    code: 'create.code',
    codeNewSplit: 'create.codeNewSplit',
    task: 'create.task',
    taskNewSplit: 'create.taskNewSplit',
    close_menu: 'create.close_menu',
  },

  // sharing
  block: {
    share: 'block.share',
    focus: 'block.focus',
    toggleSidePanel: 'block.toggleSidePanel',
  },

  // channel
  channel: {
    moveUp: 'channel.moveUp',
    moveDown: 'channel.moveDown',
    editMessage: 'channel.editMessage',
    deleteMessage: 'channel.deleteMessage',
    replyToMessage: 'channel.replyToMessage',
    expandThread: 'channel.expandThread',
    collapseThread: 'channel.collapseThread',
    focusPreviousMessage: 'channel.focusPreviousMessage',
    focusNextMessage: 'channel.focusNextMessage',
    focusInput: 'channel.focusInput',
    sendMessage: 'channel.sendMessage',
    clearSelection: 'channel.clearSelection',
    cancelReply: 'channel.cancelReply',
    threadPreviousReply: 'channel.threadPreviousReply',
    threadNextReply: 'channel.threadNextReply',
    threadExit: 'channel.threadExit',
    threadCollapse: 'channel.threadCollapse',
    threadReply: 'channel.threadReply',
    threadEditReply: 'channel.threadEditReply',
    threadDeleteReply: 'channel.threadDeleteReply',
    findInChannel: 'channel.findInChannel',
  },

  // drawer
  drawer: {
    close: 'drawer.close',
  },

  // chat input
  chat: {
    input: {
      focus: 'chat-input-focus',
    },
    spotlight: {
      toggle: 'chat-spotlight-toggle',
      close: 'chat-spotlight-close',
    },
    new: 'chat-new',
    stop: 'chat-stop',
    send: 'chat-send',
  },
} as const;

type ExtractValues<T> = T extends object ? ExtractValues<T[keyof T]> : T;
export type HotkeyToken = ExtractValues<typeof TOKENS>;

/**
 * Builds a Map from token string values to their token references
 * e.g. 'channel.moveUp' -> TOKENS.channel.moveUp
 */
function buildTokenMap(tokens: typeof TOKENS): Map<string, HotkeyToken> {
  const map = new Map<string, HotkeyToken>();

  function traverse(obj: any, path: string[] = []) {
    for (const key in obj) {
      const value = obj[key];
      const currentPath = [...path, key];

      if (typeof value === 'string') {
        // Leaf node - add to map
        map.set(value, value as HotkeyToken);
      } else if (typeof value === 'object' && value !== null) {
        // Nested object - recurse
        traverse(value, currentPath);
      }
    }
  }

  traverse(tokens);
  return map;
}

const _tokenMap = buildTokenMap(TOKENS);
