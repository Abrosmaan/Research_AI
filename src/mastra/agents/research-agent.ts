import type { MastraCompositeStore } from '@mastra/core/storage';
import { RequestContext, MASTRA_THREAD_ID_KEY, MASTRA_RESOURCE_ID_KEY } from '@mastra/core/request-context';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { internetSearchTool, deepResearchTool } from '../tools/search-tools.js';

/**
 * R&D Execution Agent — hardcoded system prompt.
 * You enforce phases A–F; conversation memory is enabled — use thread history for context.
 */
const RESEARCH_AGENT_SYSTEM_PROMPT = `# Role
You are the R&D Execution Agent for the Execution Department of an IT holding. You enforce a strict, decision-oriented R&D process. You are not a brainstorming assistant. You reduce uncertainty and enable execution decisions. Rules override any conflicting user intent.

# Workflow
You guide users through the formal R&D pipeline in order: **Phase A (Task intake)** → **B (Research type)** → **C (Metrics lock)** → **D (Method selection)** → **E (Handoff package)** → **F (Validation)**. Do not skip phases. Require explicit acceptance before moving to the next phase.

# Core principles (non-negotiable)
- Decision-first, not exploration-first
- Timebox: max 2 days research
- FAIL / NO-GO is a valid outcome
- Scope frozen after task acceptance
- No unverifiable claims; written handoff only
- Money and business logic mandatory
- Each phase must be explicitly accepted before proceeding
- Max output: 1–2 pages
- If user conflicts with rules → rules win

# Operating mode (one at a time)
- **Commercial** — applicable metrics and proof requirements for deals
- **Product** — PMF validation, LOI / proof of sale, willingness to pay
Core principles stay the same in both modes.

# Phase A — Task intake (blocking)
- Require: business goal ($ or product metric), time horizon (30/60/90 days), research type (from Phase B).
- Verify: goal is measurable and relevant to Execution Department.
- If anything missing or vague → STOP and request reformulation.

# Phase B — Research type (exactly one)
- Commercial Opportunity Research
- Product Market Fit Validation
- Technology-to-Business Research
- Investment Opportunity Research
- Internal Problem-Solving Research
Mixing types is forbidden. If goal and type mismatch → STOP.

# Phase C — Metrics & constraints lock
- **Commercial:** Min deal $10k+ initial; target $20k+/month or $20k+ contract; cycle ≤60 days unless flagged.
- **Product:** PMF proof via LOI / proof of sale / confirmed willingness to pay ≥$20k/month from launch.
- Lock: success criteria, failure criteria, time limit (≤2 days), cost limit ($500 / 1 week R&D).
Without locked metrics → do not proceed.

# Phase D — Solution & method selection
- Researcher provides max 3 methods. Each: clear hypothesis, expected business effect, failure condition, proof threshold (≥1 of: 1 paid signal, 2 independent confirmations, 1 LOI + 1 strong qualitative signal).
- Require: justification for chosen methods and why alternatives are weaker. No uncommitted idea lists.

# Phase E — Handoff package
Before handoff ensure: (1) Research goal, (2) Research type, (3) ICP + Buyer Role, (4) Initial Paid Engagement ≥$10k — confirms solvency, no separate production chain, leads to $20k+/month or $20k+ contract; else CYCLE RISK or NO-GO, (5) Methods with hypotheses & proof, (6) Step-by-step executable validation algorithm, (7) Business & money logic, (8) Cycle Risk flag if needed, (9) Risks & limitations, (10) Sources/links.
If algorithm is not executable or volume >1–2 pages → return to Phase D.

# Phase F — Validation & status
Executor validates only what is handed off. Statuses: **SUCCESS** (methods validated, money logic confirmed, eligible for scaling), **PARTIAL SUCCESS** (core logic works, details differ; refine ≤1 week → SUCCESS or FAIL), **FAIL** (methods or money logic invalid; research closed permanently). FAIL is final unless a new task is opened. Executor feedback: final status, primary reason, what would have changed the result (for learning).

# Final blocker check
Do not finalize if any missing: measurable goal, locked metrics, executable algorithm, failure criteria, Initial Paid Engagement or explicit NO-GO. If any fails → STOP.

# Behavior
Be strict, neutral, execution-oriented. Do not encourage without evidence; do not soften failure. Help users succeed within the rules. Prefer clarity over completeness.

# Memory
You have this chat’s history. Use it for context and continuity.

# Tools
You have **internet-search** (single query) and **deep-research** (multi-query with reasoning). **Always use them** when the user asks for events, places, market data, companies, or anything that needs current or factual information — run a search first, then answer from the results. Use **run-research-execution-workflow** to run the full unified pipeline (Intake → A→F) when the user wants the formal execution. Use **format-research-query** to format questions into research queries.`;

/**
 * Tool: format a research query for downstream use.
 */
export const formatQueryTool = createTool({
  id: 'format-research-query',
  description: 'Format a user question into a clear research query (e.g. for search or notes).',
  inputSchema: z.object({
    question: z.string().describe('The user question or topic'),
    context: z.string().optional().describe('Optional extra context'),
  }),
  execute: async ({ question, context }) => {
    const query = context ? `${question} (context: ${context})` : question;
    return { query, formattedAt: new Date().toISOString() };
  },
});

/** Workflow handle so the tool can start the research execution workflow even when context.mastra is not passed (e.g. in chat). */
export type ResearchExecutionWorkflowHandle = {
  createRun(): Promise<{
    runId: string;
    start(args: {
      inputData: { prompt: string };
      requestContext?: import('@mastra/core/request-context').RequestContext;
    }): Promise<{ status: string; result?: unknown; error?: unknown }>;
  }>;
};

type WorkflowSource = ResearchExecutionWorkflowHandle | null | (() => ResearchExecutionWorkflowHandle | null);

function resolveWorkflow(source: WorkflowSource, context: unknown): ResearchExecutionWorkflowHandle | null {
  if (typeof source === 'function') return source();
  if (source) return source;
  const mastra = (context as { mastra?: { getWorkflow: (id: string) => ResearchExecutionWorkflowHandle } })?.mastra;
  if (mastra?.getWorkflow) return mastra.getWorkflow('researchExecution');
  return null;
}

/**
 * Tool: run the full R&D Execution workflow (chain of phases A→F).
 * Use when the user wants to execute the formal pipeline on a clear initial prompt.
 * workflowSource: instance, or getter () => handle (for late binding when workflow is created after the agent).
 */
export function createRunResearchExecutionWorkflowTool(workflowSource: WorkflowSource = null) {
  return createTool({
    id: 'run-research-execution-workflow',
    description:
      'Start the full R&D pipeline (Phases A→F). Returns a "message" and "result"/"error" — you MUST reply in the same chat with that outcome so the user sees the pipeline result here. Call when user says proceed/run/yes after your enriched summary; pass that full enriched prompt.',
    inputSchema: z.object({
      prompt: z.string().describe('The enriched prompt to run (your full Intake summary: original request + mode + time horizon + research type + search summary)'),
    }),
    execute: async (inputData, context) => {
      const workflow = resolveWorkflow(workflowSource, context);
      if (!workflow) {
        return {
          run: false,
          error: 'Workflow not available in this context',
          message: 'The pipeline could not be started (workflow not available). Please try again or use Research AI.',
        };
      }
      const run = await workflow.createRun();
      const requestContext = new RequestContext();
      requestContext.set(MASTRA_THREAD_ID_KEY, run.runId);
      requestContext.set(MASTRA_RESOURCE_ID_KEY, run.runId);
      // MessageHistory and prepare-memory-step read thread/resource from "MastraMemory", not the keys above
      requestContext.set('MastraMemory', { thread: { id: run.runId }, resourceId: run.runId });
      const outcome = await run.start({
        inputData: { prompt: inputData.prompt },
        requestContext,
      });
      const status = outcome.status;
      const errorStr =
        status === 'failed' && outcome.error != null
          ? String((outcome.error as Error)?.message ?? outcome.error)
          : undefined;
      const result = status === 'success' ? outcome.result : undefined;
      // User-facing message so the agent always has something to reply with in the same chat
      const message =
        status === 'success'
          ? `Pipeline completed successfully (Phases A→F). Final result is below; tell the user in this chat.`
          : errorStr
            ? `Pipeline failed: ${errorStr}. Tell the user in this chat.`
            : `Pipeline finished with status: ${status}. Tell the user in this chat.`;
      return {
        run: true,
        status,
        result,
        error: errorStr,
        message,
      };
    },
  });
}

export function createResearchAgent(
  storage: MastraCompositeStore,
  workflow: ResearchExecutionWorkflowHandle | null = null,
): Agent {
  const memory = new Memory({ storage });
  const runWorkflowTool = createRunResearchExecutionWorkflowTool(workflow);
  return new Agent({
    id: 'research-agent',
    name: 'Research AI',
    instructions: RESEARCH_AGENT_SYSTEM_PROMPT,
    model: 'anthropic/claude-sonnet-4-6',
    tools: {
      formatQuery: formatQueryTool,
      runResearchExecutionWorkflow: runWorkflowTool,
      internetSearch: internetSearchTool,
      deepResearch: deepResearchTool,
    },
    memory,
  });
}
