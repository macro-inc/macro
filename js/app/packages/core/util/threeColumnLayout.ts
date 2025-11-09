export interface ThreeColumnLayout {
  isInitialized: boolean;
  leftWidth: number;
  rightWidth: number;
  rightMargin: number;
  centerWidth: number | undefined;
  windowWidth: number | undefined;
  marginWidth: number;
}

export interface ThreeColumnConfig {
  gutterPx: number;
  minLeftColumnWidth: number;
  minRightColumnWidth: number;
  maxLeftHandWidth: number;
  rightHandWidth: number;
}

export const resizeColumns = (
  centerWidth: number | undefined,
  windowWidth: number | undefined,
  oldColumns: ThreeColumnLayout,
  config: ThreeColumnConfig
): ThreeColumnLayout => {
  const lastMiddleWidth = oldColumns.centerWidth;
  const lastWindowWidth = oldColumns.windowWidth;

  if (
    !centerWidth ||
    !windowWidth ||
    (lastMiddleWidth === centerWidth && lastWindowWidth === windowWidth)
  ) {
    return oldColumns;
  }

  let rightMargin = config.gutterPx;
  let leftWidth = config.maxLeftHandWidth - config.gutterPx * 3;
  let rightWidth = config.rightHandWidth;
  const totalWidth = windowWidth - config.gutterPx * 2;

  const intendedWidth =
    centerWidth + leftWidth + rightWidth + config.gutterPx * 4;
  const marginWidth = Math.round((totalWidth - centerWidth) / 2);
  if (intendedWidth <= totalWidth) {
    rightMargin = marginWidth - rightWidth;
  } else {
    leftWidth = Math.min(
      marginWidth + config.gutterPx,
      config.maxLeftHandWidth - config.gutterPx * 3
    );
    rightWidth = Math.min(config.rightHandWidth, marginWidth);
    rightMargin = marginWidth - rightWidth + config.gutterPx;
  }

  rightWidth = Math.max(rightWidth, config.minRightColumnWidth);
  leftWidth = Math.max(leftWidth, config.minLeftColumnWidth);

  return {
    isInitialized: true,
    leftWidth,
    rightWidth,
    rightMargin,
    centerWidth,
    windowWidth,
    marginWidth,
  };
};
