export type Operation = {
  type: string;
  timeStamp: DOMHighResTimeStamp;
};

export type Operator = {
  start: (e: PointerEvent, ...args: any[]) => void;
  preview: (e: PointerEvent, ...args: any[]) => void;
  commit: (e: PointerEvent, ...args: any[]) => void;
  abort: () => void;
  reset: () => void;
  active: () => boolean;
};

export function operatorFromPartial(partial: Partial<Operator>): Operator {
  return {
    start: () => {},
    preview: () => {},
    commit: () => {},
    abort: () => {},
    reset: () => {},
    active: () => false,
    ...partial,
  };
}
