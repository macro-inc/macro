// Stands in for the app's settings: opening one records it for the test.
export const opened: string[] = [];
export const useSettingsState = () => ({
  openSettingsInSplit: (tab?: string) => {
    opened.push(tab ?? 'Account');
    document.body.dataset.openedSettings = opened.join(',');
  },
});
