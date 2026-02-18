import type { MastraCompositeStore } from '@mastra/core/storage';
import type { AnyWorkflow } from '@mastra/core/workflows';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { z } from 'zod';
import { internetSearchTool, deepResearchTool } from '../tools/search-tools.js';
import type { ResearchExecutionWorkflowHandle } from './research-agent.js';
import { createRunResearchExecutionWorkflowTool } from './research-agent.js';

const CORE_RULES = `Decision-first; timebox max 2 days; FAIL/NO-GO valid; scope frozen after acceptance; no unverifiable claims; written handoff only; money logic mandatory; max 1–2 pages. Rules override user intent.`;

const sharedTools = {
  internetSearch: internetSearchTool,
  deepResearch: deepResearchTool,
};

// —— Phase A output ———
export const PhaseAOutputSchema = z.object({
  phase: z.literal('A').describe('Always "A" for Phase A'),
  accepted: z.boolean().describe('True only if business goal, time horizon (30/60/90), research type, and mode are clear and measurable'),
  businessGoal: z.string().describe('One clear sentence with $ or product metric'),
  timeHorizonDays: z
    .union([z.literal(30), z.literal(60), z.literal(90)])
    .describe('Exactly one of: 30, 60, or 90 (number)'),
  researchType: z
    .enum([
      'Commercial Opportunity Research',
      'Product Market Fit Validation',
      'Technology-to-Business Research',
      'Investment Opportunity Research',
      'Internal Problem-Solving Research',
    ])
    .describe('Exactly one of the five research types; no other values'),
  rejectedReason: z
    .string()
    .optional()
    .describe('If accepted is false, short list of what is missing or vague'),
  mode: z.enum(['commercial', 'product']).describe('Exactly "commercial" or "product"'),
});

// —— Phase B output (extends A) ———
export const PhaseBOutputSchema = PhaseAOutputSchema.extend({
  phase: z.literal('B'),
  researchTypeValidated: z.boolean(),
  validationNotes: z.string().optional(),
});

// —— Phase C output ———
export const PhaseCOutputSchema = PhaseBOutputSchema.extend({
  phase: z.literal('C'),
  successCriteria: z.string(),
  failureCriteria: z.string(),
  timeLimitDays: z.number().min(1).max(2),
  costLimitUsd: z.number().max(500),
  cycleRiskOrNoGo: z.boolean().optional(),
});

// —— Phase D: methods ———
const MethodSchema = z.object({
  hypothesis: z.string(),
  expectedBusinessEffect: z.string(),
  failureCondition: z.string(),
  proofThreshold: z.string(),
});
export const PhaseDOutputSchema = PhaseCOutputSchema.extend({
  phase: z.literal('D'),
  methods: z.array(MethodSchema).min(1).max(3),
  methodsJustification: z.string(),
});

// —— Phase E output ———
export const PhaseEOutputSchema = PhaseDOutputSchema.extend({
  phase: z.literal('E'),
  handoffPackage: z.object({
    researchGoal: z.string(),
    researchType: z.string(),
    icpAndBuyerRole: z.string(),
    initialPaidEngagement: z.string(),
    methodsWithHypothesesAndProof: z.string(),
    validationAlgorithm: z.string(),
    businessAndMoneyLogic: z.string(),
    cycleRiskFlag: z.boolean().optional(),
    risksAndLimitations: z.string(),
    sourcesOrLinks: z.string(),
  }),
  handoffWithinPageLimit: z.boolean(),
});

// —— Phase F output ———
export const PhaseFOutputSchema = PhaseEOutputSchema.extend({
  phase: z.literal('F'),
  status: z.enum(['SUCCESS', 'PARTIAL_SUCCESS', 'FAIL']),
  executorFeedback: z.object({
    primaryReason: z.string(),
    whatWouldHaveChangedResult: z.string().optional(),
  }),
});

const PHASE_A_RESEARCH_TYPES = [
  'Commercial Opportunity Research',
  'Product Market Fit Validation',
  'Technology-to-Business Research',
  'Investment Opportunity Research',
  'Internal Problem-Solving Research',
] as const;

function phaseAInstructions(): string {
  return `You are Phase A — TASK INTAKE of the R&D Execution process. ${CORE_RULES}

## Your input
You receive a single string: the **enriched prompt** from the Intake step. It may include the original request, mode (commercial/product), time horizon (30/60/90 days), and search/reasoning summary. Extract or infer the required fields from this text. Use internet-search and deep-research only when you need to validate or clarify (e.g. market size, company facts).

## Your output (strict JSON only)
You MUST respond with exactly this JSON shape — no extra text, no markdown, no explanation:
- **phase**: always "A"
- **accepted**: true only if all required items are clear and measurable; otherwise false
- **businessGoal**: one clear sentence with $ or product metric (e.g. "Achieve $20k MRR from SMB segment" or "Validate willingness to pay ≥$20k/month")
- **timeHorizonDays**: exactly one of 30, 60, 90 (number)
- **researchType**: exactly one of: ${PHASE_A_RESEARCH_TYPES.join(' | ')}
- **mode**: exactly "commercial" or "product"
- **rejectedReason**: (optional) if accepted is false, state what is missing or vague (e.g. "No time horizon stated", "Goal not measurable")

## When to accept vs reject
- **accepted: true** only when: (1) business goal is stated and measurable, (2) time horizon is 30/60/90 days, (3) research type is clearly one of the five above, (4) mode is commercial or product. Then fill every required field.
- **accepted: false** when anything is missing, vague, or not measurable. Set rejectedReason to a short, specific list of what to fix (e.g. "Missing: time horizon, research type. Goal too vague."). You may still fill businessGoal, timeHorizonDays, researchType, mode if you can infer them; otherwise use best guess and note in rejectedReason.

## Rules
- researchType must be exactly one of the five strings above (no variations).
- timeHorizonDays must be the number 30, 60, or 90.
- Output only valid JSON matching the schema. No preamble.`;
}

function phaseBInstructions(): string {
  return `You are Phase B — RESEARCH TYPE VALIDATION. ${CORE_RULES}
You have internet-search and deep-research tools: use them to validate research type fit (e.g. market vs product signals).
You receive Phase A output. Classify into exactly one type: Commercial Opportunity Research | Product Market Fit Validation | Technology-to-Business Research | Investment Opportunity Research | Internal Problem-Solving Research. Mixing is forbidden. If goal and type mismatch, set researchTypeValidated: false and validationNotes; else researchTypeValidated: true.
Pass through all prior fields (phase A) and add phase B fields. Output only the structured JSON.`;
}

function phaseCInstructions(): string {
  return `You are Phase C — METRICS & CONSTRAINTS LOCK. ${CORE_RULES}
You have internet-search and deep-research tools: use them to ground metrics (e.g. benchmarks, comparable deals).
Lock: successCriteria, failureCriteria, timeLimitDays (1 or 2), costLimitUsd (max 500). Commercial: min deal $10k+, target $20k+/month or $20k+ contract, cycle ≤60 days. Product: PMF via LOI/proof of sale/willingness to pay ≥$20k/month. Set cycleRiskOrNoGo if applicable.
Pass through all prior fields and add phase C fields. Output only the structured JSON.`;
}

function phaseDInstructions(): string {
  return `You are Phase D — SOLUTION & METHOD SELECTION. ${CORE_RULES}
You have internet-search and deep-research tools: use them to support hypotheses or find proof thresholds (e.g. similar validation methods).
Researcher provides max 3 methods. Each: hypothesis, expectedBusinessEffect, failureCondition, proofThreshold (at least one of: 1 paid signal, 2 independent confirmations, 1 LOI + 1 strong qualitative). methodsJustification: why chosen and why alternatives weaker. No uncommitted lists.
Pass through all prior fields and add phase D fields. Output only the structured JSON.`;
}

function phaseEInstructions(): string {
  return `You are Phase E — HANDOFF PACKAGE FORMATION. ${CORE_RULES}
You have internet-search and deep-research tools: use them to fill sources/links and validate ICP or engagement criteria.
Build handoffPackage: researchGoal, researchType, icpAndBuyerRole, initialPaidEngagement (≥$10k or NO-GO), methodsWithHypothesesAndProof, validationAlgorithm (step-by-step executable), businessAndMoneyLogic, cycleRiskFlag if needed, risksAndLimitations, sourcesOrLinks. handoffWithinPageLimit: true only if package fits 1–2 pages and algorithm is executable; else false.
Pass through all prior fields and add phase E fields. Output only the structured JSON.`;
}

function phaseFInstructions(): string {
  return `You are Phase F — VALIDATION & STATUS. ${CORE_RULES}
You have internet-search and deep-research tools. Use them only if one quick check is essential; prefer validating from the handoff package alone to keep the step fast.
Executor validates. Set status: SUCCESS (methods validated, money logic confirmed) | PARTIAL_SUCCESS (core works, details differ) | FAIL (methods or money logic invalid). executorFeedback: primaryReason, whatWouldHaveChangedResult (for learning).
Pass through all prior fields and add phase F fields. Output only the structured JSON.`;
}

const model = 'anthropic/claude-sonnet-4-6';

// —— Intake output schema ———
export const IntakeOutputSchema = z.object({
  enrichedPrompt: z.string().describe('Single prompt combining original request, mode, time horizon, and concise search/reasoning summary for Phase A'),
});

function intakeInstructions(): string {
  return `You are the INTAKE step of the R&D Execution workflow. ${CORE_RULES}
You receive the user's initial R&D request. You have **internet-search** and **deep-research** tools.
**Always use them** when the user asks for events, places, market data, lists, or anything needing current information — run at least one search, then summarize in your enrichedPrompt. Use them to: (1) clarify market/company context if needed, (2) reason about mode (commercial vs product), (3) surface relevant benchmarks or constraints.

Your output is a single **enrichedPrompt** string for Phase A. Structure it so Phase A can extract fields easily. Include clearly: **Original request**; **Mode**: "commercial" or "product" (infer if not stated); **Time horizon**: if mentioned, state as "30", "60", or "90" days (if unclear, say "Time horizon not specified"); **Research type** if inferable (one of: Commercial Opportunity Research | Product Market Fit Validation | Technology-to-Business Research | Investment Opportunity Research | Internal Problem-Solving Research); **Short summary** of any search/reasoning that helps Phase A. Keep under 1 page.

## CRITICAL: Run the pipeline after research
You have the **run-research-execution-workflow** tool. Your job is to run the full pipeline (Phases A–F) once you have an enriched prompt and the user wants to proceed.
- **When you MUST call it:** (1) When the user says anything like: "proceed", "run it", "go", "yes", "do it", "execute", "start", "run the workflow", "go ahead", "ok", "sure", "please run", "move to Phase A". (2) When the user's first message is "run the full process" or "execute the pipeline" for a topic.
- **After you've done research:** If you already gave an enriched summary in this thread and the user's latest message is short and affirmative (e.g. "yes", "ok", "go", "run", "proceed"), do NOT just reply with text — **call run-research-execution-workflow immediately** with the enriched prompt you produced. One tool call, then confirm the pipeline started.
- **What to pass:** Always pass the **enrichedPrompt** string (your full summary with original request, mode, time horizon, research type, and search summary). Use the last enriched summary you wrote in this conversation.
- **Every time you finish a research summary:** End with exactly: "Say **proceed** or **run it** to start the full pipeline (Phases A–F)." So the user knows one word will trigger it.

## After running the workflow — reply in this chat
When you have just called **run-research-execution-workflow**, the tool returns a **message** and optionally **result** or **error**. You MUST reply to the user in this same chat with that outcome: (1) Say that the pipeline ran. (2) If the tool returned a **message**, use it. (3) If there is a **result**, summarize the key points (e.g. Phase F status, handoff, executor feedback) in a short paragraph. (4) If there is an **error**, tell the user what went wrong. Never leave the user without a reply in this thread after the workflow runs.`;
}

/**
 * Creates all phase agents and the intake agent with memory. They are used as workflow steps
 * (Intake → Phase A → … → Phase F). When the workflow is started from the tool, requestContext
 * with threadId (runId) is passed so MessageHistory can persist; when chatting in Studio,
 * threads are per-agent so you can return to a conversation. When getWorkflow is provided,
 * the intake agent gets a tool to trigger researchExecution and the workflow is attached.
 */
export function createPhaseAgentsWithMemory(
  storage: MastraCompositeStore,
  getWorkflow?: () => ResearchExecutionWorkflowHandle | AnyWorkflow | null,
) {
  const memory = new Memory({ storage });
  const intakeTools = getWorkflow
    ? { ...sharedTools, runResearchExecutionWorkflow: createRunResearchExecutionWorkflowTool(getWorkflow) }
    : sharedTools;

  const intakeAgent = new Agent({
    id: 'intake-agent',
    name: 'Intake — Research & Enrichment',
    instructions: intakeInstructions(),
    model,
    tools: intakeTools,
    memory,
    workflows: getWorkflow
      ? () => {
          const w = getWorkflow();
          return w != null ? ({ researchExecution: w } as Record<string, AnyWorkflow>) : {};
        }
      : undefined,
  });

  const phaseAAgent = new Agent({
    id: 'phase-a-agent',
    name: 'Phase A — Task Intake',
    instructions: phaseAInstructions(),
    model,
    tools: sharedTools,
    memory,
  });

  const phaseBAgent = new Agent({
    id: 'phase-b-agent',
    name: 'Phase B — Research Type',
    instructions: phaseBInstructions(),
    model,
    tools: sharedTools,
    memory,
  });

  const phaseCAgent = new Agent({
    id: 'phase-c-agent',
    name: 'Phase C — Metrics Lock',
    instructions: phaseCInstructions(),
    model,
    tools: sharedTools,
    memory,
  });

  const phaseDAgent = new Agent({
    id: 'phase-d-agent',
    name: 'Phase D — Method Selection',
    instructions: phaseDInstructions(),
    model,
    tools: sharedTools,
    memory,
  });

  const phaseEAgent = new Agent({
    id: 'phase-e-agent',
    name: 'Phase E — Handoff Package',
    instructions: phaseEInstructions(),
    model,
    tools: sharedTools,
    memory,
  });

  const phaseFAgent = new Agent({
    id: 'phase-f-agent',
    name: 'Phase F — Validation & Status',
    instructions: phaseFInstructions(),
    model,
    tools: sharedTools,
    memory,
  });

  return {
    intakeAgent,
    phaseAAgent,
    phaseBAgent,
    phaseCAgent,
    phaseDAgent,
    phaseEAgent,
    phaseFAgent,
  };
}
