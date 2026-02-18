import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
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

// Tracing: persist traces to storage for Mastra Studio + optional Mastra Cloud
// https://mastra.ai/docs/observability/tracing/overview
const require = createRequire(import.meta.url);
function getObservability(): import('@mastra/core/observability').ObservabilityEntrypoint | undefined {
  try {
    const obs = require('@mastra/observability');
    const Observability = obs.Observability;
    const DefaultExporter = obs.DefaultExporter;
    const CloudExporter = obs.CloudExporter;
    const SensitiveDataFilter = obs.SensitiveDataFilter;
    if (!Observability || !DefaultExporter) return undefined;
    return new Observability({
      configs: {
        default: {
          serviceName: 'research-ai',
          exporters: [
            new DefaultExporter(), // Persists traces to storage for Mastra Studio
            ...(CloudExporter ? [new CloudExporter()] : []), // Mastra Cloud if MASTRA_CLOUD_ACCESS_TOKEN is set
          ],
          spanOutputProcessors: SensitiveDataFilter ? [new SensitiveDataFilter()] : [],
        },
      },
    });
  } catch {
    return undefined;
  }
}
const observability = getObservability();

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
  ...(observability ? { observability } : {}),
});

export { mastra };
