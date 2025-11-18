export const TOKENS = {
  // soup
  soup: {
    openSearch: 'soup.openSearch',
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
    macroJump: 'global.macroJump',
    toggleRightPanel: 'global.toggleRightPanel',
    commandMenu: 'global.commandMenu',
    toggleBigChat: 'global.toggleBigChat',
    instructions: 'global.instructions',
    searchMenu: 'global.searchMenu',
    toggleSettings: 'global.toggleSettings',
    createNewSplit: 'global.createNewSplit',
    showHotkeys: 'global.showHotkeys',
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
    spotlight: {
      toggle: 'split.spotlight.toggle',
      close: 'split.spotlight.close',
    },
    back: 'split.back',
    forward: 'split.forward',
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
