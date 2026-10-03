import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowEdge,
  ExecutionTrace,
  StepTrace,
  NodeStatus,
} from "../types/index.ts";
import { executeLLM } from "./llm-provider.ts";

export class DAGValidationError extends Error {
  public readonly cycleNodes?: string[];

  constructor(message: string, cycleNodes?: string[]) {
    super(message);
    this.name = "DAGValidationError";
    this.cycleNodes = cycleNodes;
  }
}

export class DAGEngine {
  /**
   * Validates if the workflow graph is a valid DAG (Acyclic).
   * Uses Tarjan / Kahn's algorithm for topological sorting and cycle detection.
   */
  public static validateGraph(workflow: WorkflowDefinition): {
    isValid: boolean;
    sortedNodeIds: string[];
  } {
    const adjList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    workflow.nodes.forEach((n) => {
      adjList.set(n.id, []);
      inDegree.set(n.id, 0);
    });

    workflow.edges.forEach((edge) => {
      if (!adjList.has(edge.source) || !adjList.has(edge.target)) {
        throw new DAGValidationError(
          `Edge references nonexistent node: ${edge.source} -> ${edge.target}`
        );
      }
      adjList.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    });

    const queue: string[] = [];
    inDegree.forEach((deg, nodeId) => {
      if (deg === 0) queue.push(nodeId);
    });

    const sorted: string[] = [];
    while (queue.length > 0) {
      const u = queue.shift()!;
      sorted.push(u);

      for (const v of adjList.get(u) || []) {
        inDegree.set(v, inDegree.get(v)! - 1);
        if (inDegree.get(v) === 0) {
          queue.push(v);
        }
      }
    }

    if (sorted.length !== workflow.nodes.length) {
      const cyclicNodes = workflow.nodes
        .filter((n) => !sorted.includes(n.id))
        .map((n) => n.id);
      throw new DAGValidationError(
        `Cycle detected in workflow graph involving nodes: ${cyclicNodes.join(", ")}`,
        cyclicNodes
      );
    }

    return { isValid: true, sortedNodeIds: sorted };
  }

  /**
   * Resolves template placeholders like {{nodes.prompt_1.rendered}} or {{input.text}}
   */
  public static interpolateTemplate(template: string, context: Record<string, any>): string {
    return template.replace(/\{\{([\w\.]+)\}\}/g, (_, path) => {
      const keys = path.split(".");
      let current: any = context;
      for (const key of keys) {
        if (current === undefined || current === null) return "";
        current = current[key];
      }
      return current !== undefined ? String(current) : "";
    });
  }

  /**
   * Executes the entire workflow step by step with rich tracing & telemetry
   */
  public static async execute(
    workflow: WorkflowDefinition,
    initialInput: Record<string, any> = {},
    onStepUpdate?: (step: StepTrace) => void
  ): Promise<ExecutionTrace> {
    const startTime = Date.now();
    const { sortedNodeIds } = this.validateGraph(workflow);
    const nodeMap = new Map<string, WorkflowNode>(workflow.nodes.map((n) => [n.id, n]));

    const context: Record<string, any> = {
      input: initialInput,
      nodes: {},
    };

    const steps: StepTrace[] = [];
    let totalTokens = 0;
    let estimatedCostUsd = 0;
    let finalOutput: Record<string, any> = {};

    for (const nodeId of sortedNodeIds) {
      const node = nodeMap.get(nodeId)!;
      const stepStartTime = Date.now();

      const stepTrace: StepTrace = {
        stepId: `step_${nodeId}_${Date.now()}`,
        nodeId: node.id,
        nodeTitle: node.title,
        nodeType: node.type,
        status: "running",
        startedAt: stepStartTime,
        input: { ...node.config },
      };

      if (onStepUpdate) onStepUpdate({ ...stepTrace });

      try {
        let nodeOutput: Record<string, any> = {};

        switch (node.type) {
          case "trigger": {
            nodeOutput = { ...initialInput, triggeredAt: new Date().toISOString() };
            break;
          }

          case "prompt": {
            const rawTemplate = node.config.template || "";
            const rendered = this.interpolateTemplate(rawTemplate, context);
            nodeOutput = { rendered, template: rawTemplate };
            break;
          }

          case "llm": {
            const userPrompt = node.config.prompt
              ? this.interpolateTemplate(node.config.prompt, context)
              : context.nodes[workflow.edges.find((e) => e.target === nodeId)?.source || ""]?.rendered ||
                initialInput.prompt ||
                "Hello AI";

            const systemPrompt = node.config.systemPrompt
              ? this.interpolateTemplate(node.config.systemPrompt, context)
              : undefined;

            const model = node.config.model || "mock-fast";
            const response = await executeLLM({
              model,
              systemPrompt,
              userPrompt,
              temperature: node.config.temperature ?? 0.7,
              maxTokens: node.config.maxTokens ?? 1024,
              language: initialInput.language || "tr",
            });

            nodeOutput = {
              content: response.content,
              model: response.model,
              usage: response.usage,
            };

            stepTrace.tokensUsed = response.usage;
            stepTrace.costUsd = response.costUsd;
            totalTokens += response.usage.totalTokens;
            estimatedCostUsd += response.costUsd;
            break;
          }

          case "tool": {
            const toolName = node.config.toolName || "calculator";
            const toolInput = node.config.input
              ? this.interpolateTemplate(node.config.input, context)
              : "";

            nodeOutput = await this.executeBuiltinTool(toolName, toolInput, context);
            break;
          }

          case "condition": {
            const expression = node.config.condition || "true";
            const evalResult = this.evaluateCondition(expression, context);
            nodeOutput = { branch: evalResult ? "true" : "false", conditionMet: evalResult };
            break;
          }

          case "output": {
            const resultTemplate = node.config.format || "{{nodes.last.content}}";
            const formatted = this.interpolateTemplate(resultTemplate, context);
            nodeOutput = { result: formatted, completed: true };
            finalOutput = nodeOutput;
            break;
          }

          default:
            nodeOutput = { note: `Unknown node type ${node.type}` };
        }

        const stepEndTime = Date.now();
        stepTrace.status = "completed";
        stepTrace.completedAt = stepEndTime;
        stepTrace.durationMs = stepEndTime - stepStartTime;
        stepTrace.output = nodeOutput;

        context.nodes[node.id] = nodeOutput;
        steps.push(stepTrace);
        if (onStepUpdate) onStepUpdate({ ...stepTrace });
      } catch (err: any) {
        const stepEndTime = Date.now();
        stepTrace.status = "failed";
        stepTrace.completedAt = stepEndTime;
        stepTrace.durationMs = stepEndTime - stepStartTime;
        stepTrace.error = err.message || "Execution failed";
        steps.push(stepTrace);
        if (onStepUpdate) onStepUpdate({ ...stepTrace });

        return {
          id: `trace_${workflow.id}_${Date.now()}`,
          workflowId: workflow.id,
          status: "failed",
          startedAt: startTime,
          completedAt: Date.now(),
          totalDurationMs: Date.now() - startTime,
          totalTokens,
          estimatedCostUsd,
          steps,
        };
      }
    }

    const endTime = Date.now();
    return {
      id: `trace_${workflow.id}_${Date.now()}`,
      workflowId: workflow.id,
      status: "completed",
      startedAt: startTime,
      completedAt: endTime,
      totalDurationMs: endTime - startTime,
      totalTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(6)),
      steps,
      finalOutput,
    };
  }

  private static async executeBuiltinTool(
    toolName: string,
    input: string,
    context: Record<string, any>
  ): Promise<Record<string, any>> {
    switch (toolName) {
      case "text_summarizer": {
        const wordCount = input.trim().split(/\s+/).length;
        return {
          summary: `Synthesized key points from input (${wordCount} words analyzed).`,
          wordCount,
          status: "success",
        };
      }
      case "json_transform": {
        try {
          const parsed = JSON.parse(input);
          return { data: parsed, keys: Object.keys(parsed), success: true };
        } catch {
          return { text: input, raw: true };
        }
      }
      case "sentiment_eval": {
        const positiveWords = ["great", "excellent", "fast", "good", "love", "amazing"];
        const lower = input.toLowerCase();
        const score = positiveWords.some((w) => lower.includes(w)) ? 0.92 : 0.45;
        return { sentiment: score > 0.5 ? "positive" : "neutral", confidenceScore: score };
      }
      case "math_eval": {
        try {
          const sanitized = input.replace(/[^0-9+\-*/().]/g, "");
          // Safe simple evaluation without raw eval
          const result = Function(`"use strict"; return (${sanitized})`)();
          return { expression: input, result };
        } catch {
          return { error: "Invalid math expression", input };
        }
      }
      default:
        return { output: `Tool [${toolName}] processed input: ${input}` };
    }
  }

  private static evaluateCondition(condition: string, context: Record<string, any>): boolean {
    if (condition === "true") return true;
    if (condition === "false") return false;
    const interpolated = this.interpolateTemplate(condition, context);
    return interpolated.trim().length > 0 && interpolated !== "false" && interpolated !== "0";
  }
}
