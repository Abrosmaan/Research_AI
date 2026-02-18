# Research_AI

Welcome to your new [Mastra](https://mastra.ai/) project! We're excited to see what you'll build.

## Getting Started

Start the development server:

```shell
npm run dev
```

Open [http://localhost:4111](http://localhost:4111) in your browser to access [Mastra Studio](https://mastra.ai/docs/getting-started/studio). It provides an interactive UI for building and testing your agents, along with a REST API that exposes your Mastra application as a local service. This lets you start building without worrying about integration right away.

You can start editing files inside the `src/mastra` directory. The development server will automatically reload whenever you make changes.

## Workflow runs: checking status and timeouts

- **Is a run still working?** Check (1) the terminal where `mastra dev` / `mastra start` is running — you should see logs for each step and tool call; (2) in [Mastra Studio](http://localhost:4111), open **Workflows** and find the run by ID (the tool returns `workflowRunId`) to see step status.
- **Timeouts:** If a workflow run exceeds **10 minutes**, the tool cancels it and returns a timeout message so the chat doesn’t hang. Phase F is instructed to use search tools only when essential to keep runs shorter.

## Tracing

The project is wired for [Mastra Tracing](https://mastra.ai/docs/observability/tracing/overview): agent runs, tool calls, and workflow steps can be persisted to storage and viewed in Studio. Configuration is in `src/mastra/index.ts` (DefaultExporter for Studio, optional CloudExporter and SensitiveDataFilter). Tracing is enabled when a compatible `@mastra/observability` package is available; otherwise the app runs without observability.

## Deploy to Vercel

This project is configured with `VercelDeployer` in `src/mastra/index.ts`, so `npm run build` generates Vercel Build Output in `.vercel/output`.

- Install deps: `npm install`
- Build locally: `npm run build`
- Deploy on Vercel (Git integration or CLI) and test: `https://<your-project>.vercel.app/api/agents`

### Required environment variables (Vercel)

- `OPENAI_API_KEY` (or your model provider key)
- `MASTRA_STORAGE_URL` (recommended external LibSQL/Postgres-backed URL for persistent storage)
- `MASTRA_CLOUD_ACCESS_TOKEN` (optional, only if using `CloudExporter`)

If `MASTRA_STORAGE_URL` is not set on Vercel, the app falls back to in-memory storage to avoid filesystem writes in serverless runtime.

## Learn more

To learn more about Mastra, visit our [documentation](https://mastra.ai/docs/). Your bootstrapped project includes example code for [agents](https://mastra.ai/docs/agents/overview), [tools](https://mastra.ai/docs/agents/using-tools), [workflows](https://mastra.ai/docs/workflows/overview), [scorers](https://mastra.ai/docs/evals/overview), and [observability](https://mastra.ai/docs/observability/overview).

If you're new to AI agents, check out our [course](https://mastra.ai/course) and [YouTube videos](https://youtube.com/@mastra-ai). You can also join our [Discord](https://discord.gg/BTYqqHKUrf) community to get help and share your projects.

## Deploy on Mastra Cloud

[Mastra Cloud](https://cloud.mastra.ai/) gives you a serverless agent environment with atomic deployments. Access your agents from anywhere and monitor performance. Make sure they don't go off the rails with evals and tracing.

Check out the [deployment guide](https://mastra.ai/docs/deployment/overview) for more details.
