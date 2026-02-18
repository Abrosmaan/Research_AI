import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { createPhaseAgentsWithMemory } from './agents/phase-agents.js';
import { createResearchAgent } from './agents/research-agent.js';
import { createResearchExecutionWorkflow } from './workflows/research-execution-workflow.js';

const dbDir = path.join(process.cwd(), '.mastra');
mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'mastra.db');
const storage = new LibSQLStore({
  id: 'mastra-storage',
  url: pathToFileURL(dbPath).href,
});

// All agents use the same storage and have memory (so Studio shows "memory" and workflow uses the same instances).
// Intake agent gets a getter so it can trigger researchExecution once the workflow exists (created below).
let researchExecutionWorkflow: ReturnType<typeof createResearchExecutionWorkflow>;
const getResearchExecutionWorkflow = () => researchExecutionWorkflow ?? null;

const {
  intakeAgent,
  phaseAAgent,
  phaseBAgent,
  phaseCAgent,
  phaseDAgent,
  phaseEAgent,
  phaseFAgent,
} = createPhaseAgentsWithMemory(storage, getResearchExecutionWorkflow);

researchExecutionWorkflow = createResearchExecutionWorkflow({
  intakeAgent,
  phaseAAgent,
  phaseBAgent,
  phaseCAgent,
  phaseDAgent,
  phaseEAgent,
  phaseFAgent,
});

const researchAgent = createResearchAgent(storage, researchExecutionWorkflow);

const mastra = new Mastra({
  agents: {
    researchAgent,
    intakeAgent,
    phaseAAgent,
    phaseBAgent,
    phaseCAgent,
    phaseDAgent,
    phaseEAgent,
    phaseFAgent,
  },
  workflows: { researchExecution: researchExecutionWorkflow },
  storage,
});

export { mastra };
