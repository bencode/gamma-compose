export type AgentConfig =
  | { enabled: false }
  | { enabled: true; provider: 'zai-coding-cn'; modelId: string }
