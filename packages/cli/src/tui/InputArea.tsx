/**
 * Phase 14: TUI 底部输入区——"> " 前缀 + 单行输入，支持 Enter 提交。
 */
import React from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";
export interface InputAreaProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder?: string;
  focus?: boolean;
}

export function InputArea({
  value,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
}: InputAreaProps): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="gray">
      <Text color="green">{"> "}</Text>
      <TextInput
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        placeholder={placeholder}
        focus={focus}
      />
    </Box>
  );
}
