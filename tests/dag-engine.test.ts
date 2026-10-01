import { describe, it, expect } from "vitest";
import { DAGEngine, DAGValidationError } from "../src/core/dag-engine";
import { WorkflowDefinition } from "../src/types";

describe("DAGEngine", () => {
  const validWorkflow: WorkflowDefinition = {
    id: "wf_test_valid",
    name: "Valid Linear Agent Flow",
    description: "Triggers prompt, runs LLM, formats output",
    version: "1.0.0",
    nodes: [
      {
        id: "trigger_1",
        type: "trigger",
        title: "User Query",
        position: { x: 0, y: 0 },
        config: {},
      },
      {
        id: "prompt_1",
        type: "prompt",
        title: "Format Prompt",
        position: { x: 200, y: 0 },
        config: { template: "Analyze query: {{input.query}}" },
      },
      {
        id: "llm_1",
        type: "llm",
        title: "LLM Step",
        position: { x: 400, y: 0 },
        config: { model: "mock-fast" },
      },
      {
        id: "output_1",
        type: "output",
        title: "Format Output",
        position: { x: 600, y: 0 },
        config: { format: "Result: {{nodes.llm_1.content}}" },
      },
    ],
    edges: [
      { id: "e1", source: "trigger_1", target: "prompt_1" },
      { id: "e2", source: "prompt_1", target: "llm_1" },
      { id: "e3", source: "llm_1", target: "output_1" },
    ],
  };

  it("should validate and compute topological order of an acyclic graph", () => {
    const { isValid, sortedNodeIds } = DAGEngine.validateGraph(validWorkflow);
    expect(isValid).toBe(true);
    expect(sortedNodeIds).toEqual(["trigger_1", "prompt_1", "llm_1", "output_1"]);
  });

  it("should detect cyclic graphs and throw DAGValidationError", () => {
    const cyclicWorkflow: WorkflowDefinition = {
      ...validWorkflow,
      edges: [
        { id: "e1", source: "trigger_1", target: "prompt_1" },
        { id: "e2", source: "prompt_1", target: "llm_1" },
        { id: "e3", source: "llm_1", target: "prompt_1" }, // Circular dependency!
      ],
    };

    expect(() => DAGEngine.validateGraph(cyclicWorkflow)).toThrow(DAGValidationError);
  });

  it("should interpolate template variables correctly", () => {
    const context = {
      input: { query: "Quantum Computing" },
      nodes: {
        tool_1: { count: 42 },
      },
    };

    const rendered = DAGEngine.interpolateTemplate(
      "Query is '{{input.query}}' with count {{nodes.tool_1.count}}",
      context
    );

    expect(rendered).toBe("Query is 'Quantum Computing' with count 42");
  });

  it("should execute the workflow end-to-end and generate trace telemetry", async () => {
    const trace = await DAGEngine.execute(validWorkflow, { query: "Benchmark test" });

    expect(trace.status).toBe("completed");
    expect(trace.steps.length).toBe(4);
    expect(trace.totalDurationMs).toBeGreaterThan(0);
    expect(trace.finalOutput?.completed).toBe(true);
  });
});
