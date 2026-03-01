export class LoopLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopLimitError";
  }
}

export class LoopSpinDetectedError extends Error {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly repeatCount: number
  ) {
    super(message);
    this.name = "LoopSpinDetectedError";
  }
}
