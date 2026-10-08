/** Owned by one Tauri provider; editors register saves while they are mounted. */
export function createNativeUpdatePreparation(options: {
  isBlocked(): boolean;
  flush(): Promise<void>;
}) {
  const saves = new Set<() => Promise<void>>();
  return {
    register(save: () => Promise<void>) {
      saves.add(save);
      return () => {
        saves.delete(save);
      };
    },
    async prepare() {
      if (options.isBlocked())
        throw new Error(
          'Finish your call, upload, or import before restarting Macro.'
        );
      await Promise.all([...saves].map((save) => save()));
      await options.flush();
      if (options.isBlocked())
        throw new Error('Finish your current work before restarting Macro.');
    },
  };
}
