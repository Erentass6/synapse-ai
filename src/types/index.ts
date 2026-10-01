export type NodeType =
  | "trigger"
  | "prompt"
  | "llm"
  | "tool"
  | "condition"
  | "output";

export type NodeStatus = "idle" | "running" | "completed" | "failed" | "skipped";

export interface WorkflowNode {
  id: string;
  type: NodeType;
  title: string;
  description?: string;
  position: { x: number; y: number };
  config: Record<string, any>;
  status?: NodeStatus;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface StepTrace {
  stepId: string;
  nodeId: string;
  nodeTitle: string;
  nodeType: NodeType;
  status: NodeStatus;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  input: Record<string, any>;
  output?: Record<string, any>;
  error?: string;
  tokensUsed?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  costUsd?: number;
}

export interface ExecutionTrace {
  id: string;
  workflowId: string;
  status: "running" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  totalDurationMs?: number;
  totalTokens: number;
  estimatedCostUsd: number;
  steps: StepTrace[];
  finalOutput?: Record<string, any>;
}

export type LLMModel =
  | "gpt-4o"
  | "gpt-4o-mini"
  | "claude-3-5-sonnet"
  | "gemini-1.5-pro"
  | "gemini-1.5-flash"
  | "mock-fast";

export interface LLMRequest {
  model: LLMModel;
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  streaming?: boolean;
}

export interface LLMResponse {
  content: string;
  model: LLMModel;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  durationMs: number;
  costUsd: number;
}
