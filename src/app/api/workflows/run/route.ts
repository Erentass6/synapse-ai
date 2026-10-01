import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DAGEngine, DAGValidationError } from "@/core/dag-engine";
import { TokenBucketRateLimiter, PromptGuardrail } from "@/core/rate-limiter";

const workflowRequestSchema = z.object({
  workflow: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    version: z.string().optional(),
    nodes: z.array(
      z.object({
        id: z.string(),
        type: z.enum(["trigger", "prompt", "llm", "tool", "condition", "output"]),
        title: z.string(),
        position: z.object({ x: z.number(), y: z.number() }).optional(),
        config: z.record(z.any()),
      })
    ),
    edges: z.array(
      z.object({
        id: z.string(),
        source: z.string(),
        target: z.string(),
        label: z.string().optional(),
      })
    ),
  }),
  input: z.record(z.any()).optional().default({}),
});

const globalLimiter = new TokenBucketRateLimiter(60, 10);

export async function POST(req: NextRequest) {
  try {
    if (!globalLimiter.tryConsume(1)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please wait a moment." },
        { status: 429 }
      );
    }

    const body = await req.json();
    const parseResult = workflowRequestSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid workflow payload", details: parseResult.error.format() },
        { status: 400 }
      );
    }

    const { workflow, input } = parseResult.data;

    // Check prompt guardrails if query input exists
    if (typeof input.prompt === "string") {
      const guardrail = PromptGuardrail.sanitizeAndValidate(input.prompt);
      if (!guardrail.isValid) {
        return NextResponse.json(
          {
            error: "Prompt guardrail violation detected",
            reasons: guardrail.flaggedReasons,
          },
          { status: 422 }
        );
      }
    }

    const trace = await DAGEngine.execute(workflow as any, input);
    return NextResponse.json({ success: true, trace });
  } catch (error: any) {
    if (error instanceof DAGValidationError) {
      return NextResponse.json(
        { error: error.message, cycleNodes: error.cycleNodes },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
