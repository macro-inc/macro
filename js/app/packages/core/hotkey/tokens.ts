export const TOKENS = {
  // soup
  soup: {
    openSearch: 'soup.openSearch',
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
    },
  },

  // unified list
  unifiedList: {
    togglePreview: 'unifiedList.togglePreview',
  },

  // entity navigation
  entity: {
    step: {
      end: 'entity.step.end',
      start: 'entity.step.start',
    },
    jump: {
      home: 'entity.jump.home',
      end: 'entity.jump.end',
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
    create: {
      note: 'global.create.note',
      chat: 'global.create.chat',
      canvas: 'global.create.canvas',
      project: 'global.create.project',
    },
    quickCreateCommand: 'global.quickCreateCommand',
    quickCreate: {
      note: 'global.quickCreate.note',
      email: 'global.quickCreate.email',
      message: 'global.quickCreate.message',
      menuFormat: 'global.quickCreate.menuFormat',
    },
    moveCommand: 'global.jumpCommand',
    move: {
      macroJump: 'global.jump.macroJump',
    },
    toggleRightPanel: 'global.toggleRightPanel',
    commandMenu: 'global.commandMenu',
    toggleBigChat: 'global.toggleBigChat',
    instructions: 'global.instructions',
    searchMenu: 'global.searchMenu',
    toggleSettings: 'global.toggleSettings',
    createNewSplit: 'global.createNewSplit',
    toggleVisor: 'global.toggleVisor',
  },

  // email
  email: {
    nextThread: 'email.nextThread',
    previousThread: 'email.previousThread',
    send: 'email.send',
    archive: 'email.archive',
    reply: 'email.reply',
    replyAll: 'email.replyAll',
    forward: 'email.forward',
    previousMessage: 'email.previousMessage',
    nextMessage: 'email.nextMessage',
    cancelReply: 'email.cancelReply',
  },

  // split
  split: {
    close: 'split.close',
    goCommand: 'split.goCommand',
    go: {
      home: 'split.go.home',
      email: 'split.go.email',
      inbox: 'split.go.inbox',
      docs: 'split.go.docs',
      focusSplitRight: 'split.go.focusSplitRight',
      focusSplitLeft: 'split.go.focusSplitLeft',
      toggleRightPanel: 'split.go.toggleRightPanel',
      macroJump: 'split.go.macroJump',
      back: 'split.go.back',
      forward: 'split.go.forward',
    },
    spotlight: {
      toggle: 'split.spotlight.toggle',
      close: 'split.spotlight.close',
    },
    showHelpDrawer: 'split.showHelpDrawer',
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
    close_menu: 'create.close_menu',
  },

  // sharing
  block: {
    share: 'block.share',
  },

  // channel
  channel: {
    moveUp: 'channel.moveUp',
    moveDown: 'channel.moveDown',
    editMessage: 'channel.editMessage',
    replyToMessage: 'channel.replyToMessage',
    expandThread: 'channel.expandThread',
    collapseThread: 'channel.collapseThread',
    focusPreviousMessage: 'channel.focusPreviousMessage',
    focusNextMessage: 'channel.focusNextMessage',
    focusInput: 'channel.focusInput',
    sendMessage: 'channel.sendMessage',
  },

  // drawer
  drawer: {
    close: 'drawer.close',
  },

  // chat input (currently display-only)
  chat: {
    input: {
      focus: 'chat-input-focus',
    },
    spotlight: {
      toggle: 'chat-spotlight-toggle',
      close: 'chat-spotlight-close',
    },
  },
} as const;

type ExtractValues<T> = T extends object ? ExtractValues<T[keyof T]> : T;
export type HotkeyToken = ExtractValues<typeof TOKENS>;

/**
 * Builds a Map from token string values to their token references
 * e.g. 'channel.moveUp' -> TOKENS.channel.moveUp
 */
export function buildTokenMap(tokens: typeof TOKENS): Map<string, HotkeyToken> {
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

export const tokenMap = buildTokenMap(TOKENS);
