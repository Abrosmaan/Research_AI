import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { createWorkflow, createStep } from '@mastra/core/workflows';
import {
  IntakeOutputSchema,
  PhaseAOutputSchema,
  PhaseBOutputSchema,
  PhaseCOutputSchema,
  PhaseDOutputSchema,
  PhaseEOutputSchema,
  PhaseFOutputSchema,
} from '../agents/phase-agents.js';

// Workflow input: initial user/researcher prompt (single entry point)
export const WorkflowInputSchema = z.object({
  prompt: z.string().describe('Initial R&D task or request'),
});

// Agent steps expect { prompt: string }; bridge steps convert previous output into that
const AgentInputSchema = z.object({ prompt: z.string() });

function buildPromptForNextPhase(phaseLabel: string, previousOutput: unknown): string {
  return `[Previous phase output]\n${JSON.stringify(previousOutput, null, 2)}\n\nProceed to ${phaseLabel}. Output the complete structured result for this phase only (include all prior phase fields plus this phase's new fields).`;
}

export type ResearchExecutionAgents = {
  intakeAgent: Agent;
  phaseAAgent: Agent;
  phaseBAgent: Agent;
  phaseCAgent: Agent;
  phaseDAgent: Agent;
  phaseEAgent: Agent;
  phaseFAgent: Agent;
};

/**
 * Build the unified R&D Execution workflow using the given agents (all with memory).
 * Same agent instances must be registered in Mastra so the UI shows memory and workflow attachment.
 */
export function createResearchExecutionWorkflow(agents: ResearchExecutionAgents) {
  const stepIntake = createStep(agents.intakeAgent, {
    structuredOutput: { schema: IntakeOutputSchema },
  });

  const bridgeIntakeToA = createStep({
    id: 'bridge-intake-to-a',
    description: 'Pass enriched prompt from Intake to Phase A',
    inputSchema: IntakeOutputSchema,
    outputSchema: AgentInputSchema,
    execute: async ({ inputData }) => ({
      prompt: inputData.enrichedPrompt,
    }),
  });

  const stepPhaseA = createStep(agents.phaseAAgent, {
    structuredOutput: { schema: PhaseAOutputSchema },
  });

  const bridgeAtoB = createStep({
    id: 'bridge-a-to-b',
    description: 'Pass Phase A output to Phase B as context',
    inputSchema: PhaseAOutputSchema,
    outputSchema: AgentInputSchema,
    execute: async ({ inputData }) => ({
      prompt: buildPromptForNextPhase('Phase B — Research Type Validation', inputData),
    }),
  });

  const stepPhaseB = createStep(agents.phaseBAgent, {
    structuredOutput: { schema: PhaseBOutputSchema },
  });

  const bridgeBtoC = createStep({
    id: 'bridge-b-to-c',
    description: 'Pass Phase B output to Phase C as context',
    inputSchema: PhaseBOutputSchema,
    outputSchema: AgentInputSchema,
    execute: async ({ inputData }) => ({
      prompt: buildPromptForNextPhase('Phase C — Metrics & Constraints Lock', inputData),
    }),
  });

  const stepPhaseC = createStep(agents.phaseCAgent, {
    structuredOutput: { schema: PhaseCOutputSchema },
  });

  const bridgeCtoD = createStep({
    id: 'bridge-c-to-d',
    description: 'Pass Phase C output to Phase D as context',
    inputSchema: PhaseCOutputSchema,
    outputSchema: AgentInputSchema,
    execute: async ({ inputData }) => ({
      prompt: buildPromptForNextPhase('Phase D — Solution & Method Selection', inputData),
    }),
  });

  const stepPhaseD = createStep(agents.phaseDAgent, {
    structuredOutput: { schema: PhaseDOutputSchema },
  });

  const bridgeDtoE = createStep({
    id: 'bridge-d-to-e',
    description: 'Pass Phase D output to Phase E as context',
    inputSchema: PhaseDOutputSchema,
    outputSchema: AgentInputSchema,
    execute: async ({ inputData }) => ({
      prompt: buildPromptForNextPhase('Phase E — Handoff Package Formation', inputData),
    }),
  });

  const stepPhaseE = createStep(agents.phaseEAgent, {
    structuredOutput: { schema: PhaseEOutputSchema },
  });

  const bridgeEtoF = createStep({
    id: 'bridge-e-to-f',
    description: 'Pass Phase E output to Phase F as context',
    inputSchema: PhaseEOutputSchema,
    outputSchema: AgentInputSchema,
    execute: async ({ inputData }) => ({
      prompt: buildPromptForNextPhase('Phase F — Validation & Status', inputData),
    }),
  });

  const stepPhaseF = createStep(agents.phaseFAgent, {
    structuredOutput: { schema: PhaseFOutputSchema },
  });

  return createWorkflow({
    id: 'research-execution',
    name: 'R&D Execution (Unified: Intake + Phases A–F)',
    inputSchema: WorkflowInputSchema,
    outputSchema: PhaseFOutputSchema,
  })
    .then(stepIntake)
    .then(bridgeIntakeToA)
    .then(stepPhaseA)
    .then(bridgeAtoB)
    .then(stepPhaseB)
    .then(bridgeBtoC)
    .then(stepPhaseC)
    .then(bridgeCtoD)
    .then(stepPhaseD)
    .then(bridgeDtoE)
    .then(stepPhaseE)
    .then(bridgeEtoF)
    .then(stepPhaseF)
    .commit();
}

export type ResearchWorkflowOutput = z.infer<typeof PhaseFOutputSchema>;
