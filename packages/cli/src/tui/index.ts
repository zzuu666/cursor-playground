/**
 * Phase 14: TUI 入口——在 TTY 且 --tui 时渲染 Ink 根组件。
 */
import { render } from "ink";
import React from "react";
import { App } from "./App.js";
import type { TuiOptions } from "./types.js";

export type { TuiOptions, RunOneTurnFn, RunOneTurnOverrides } from "./types.js";
export { StatusBar } from "./StatusBar.js";
export { ContentArea, messagesToDisplayLines } from "./ContentArea.js";
export { InputArea } from "./InputArea.js";
export { App } from "./App.js";

/**
 * 启动 Ink TUI，阻塞直到用户退出（空行提交）。
 * 退出时由 options.onExit 负责写 transcript 与 clearSessionId。
 */
export async function runTui(options: TuiOptions): Promise<void> {
  const { waitUntilExit } = render(React.createElement(App, { options }));
  await waitUntilExit();
}
