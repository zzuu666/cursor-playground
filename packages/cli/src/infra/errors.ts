export class LoopLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LoopLimitError";
  }
}
