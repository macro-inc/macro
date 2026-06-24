export type UsageEntry = {
  model: string;
  inputTokens: number;
  outputTokens: number;
};

export class TokenTracker {
  private readonly map = new Map<
    string,
    { inputTokens: number; outputTokens: number }
  >();

  public add(
    model: { modelId: string },
    usage: { inputTokens?: number; outputTokens?: number }
  ): void {
    const prev = this.map.get(model.modelId) ?? {
      inputTokens: 0,
      outputTokens: 0,
    };
    this.map.set(model.modelId, {
      inputTokens: prev.inputTokens + (usage.inputTokens ?? 0),
      outputTokens: prev.outputTokens + (usage.outputTokens ?? 0),
    });
  }

  public toEntries(): UsageEntry[] {
    return Array.from(this.map.entries()).map(([model, u]) => ({
      model,
      ...u,
    }));
  }
}
