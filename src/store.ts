import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ApprovalRecord,
  ExecutionAuditBundle,
  ExecutionIntent,
  ExecutionTraceRecord,
  IntegrationCheckpointReport,
  LoopRun
} from "./domain.js";
import {
  parseExecutionIntent,
  parseExecutionTraceRecord,
  summarizeExecutionAuditBundle,
  summarizeExecutionAuditBundles
} from "./execution-intents.js";

export class FileRunStore {
  private readonly runsDir: string;
  private readonly checkpointsDir: string;
  private readonly approvalsDir: string;
  private readonly executionIntentsDir: string;
  private readonly executionTracesDir: string;

  constructor(private readonly rootDir: string = process.cwd()) {
    this.runsDir = join(this.rootDir, ".orchestrator", "runs");
    this.checkpointsDir = join(this.rootDir, ".orchestrator", "checkpoints");
    this.approvalsDir = join(this.rootDir, ".orchestrator", "approvals");
    this.executionIntentsDir = join(this.rootDir, ".orchestrator", "execution-intents");
    this.executionTracesDir = join(this.rootDir, ".orchestrator", "execution-traces");
  }

  async save(run: LoopRun): Promise<void> {
    await mkdir(this.runsDir, { recursive: true });
    await writeFile(this.filePath(run.id), `${JSON.stringify(run, null, 2)}\n`, "utf8");
  }

  async load(runId: string): Promise<LoopRun> {
    const content = await readFile(this.filePath(runId), "utf8");
    return migrateRun(JSON.parse(content) as Partial<LoopRun>);
  }

  async list(): Promise<LoopRun[]> {
    await mkdir(this.runsDir, { recursive: true });
    const entries = await readdir(this.runsDir);
    const runs = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.runsDir, entry), "utf8");
          return migrateRun(JSON.parse(content) as Partial<LoopRun>);
        })
    );

    return runs.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async latest(): Promise<LoopRun | undefined> {
    const [latest] = await this.list();
    return latest;
  }

  async saveCheckpoint(report: IntegrationCheckpointReport): Promise<void> {
    await mkdir(this.checkpointsDir, { recursive: true });
    await writeFile(this.checkpointFilePath(report.id), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  async loadCheckpoint(checkpointId: string): Promise<IntegrationCheckpointReport> {
    const content = await readFile(this.checkpointFilePath(checkpointId), "utf8");
    return JSON.parse(content) as IntegrationCheckpointReport;
  }

  async listCheckpoints(): Promise<IntegrationCheckpointReport[]> {
    await mkdir(this.checkpointsDir, { recursive: true });
    const entries = await readdir(this.checkpointsDir);
    const checkpoints = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.checkpointsDir, entry), "utf8");
          return JSON.parse(content) as IntegrationCheckpointReport;
        })
    );

    return checkpoints.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async latestCheckpoint(runId?: string): Promise<IntegrationCheckpointReport | undefined> {
    const checkpoints = await this.listCheckpoints();
    return runId ? checkpoints.find((checkpoint) => checkpoint.runId === runId) : checkpoints[0];
  }

  async saveApproval(approval: ApprovalRecord): Promise<void> {
    await mkdir(this.approvalsDir, { recursive: true });
    await writeFile(this.approvalFilePath(approval.id), `${JSON.stringify(approval, null, 2)}\n`, "utf8");
  }

  async loadApproval(approvalId: string): Promise<ApprovalRecord> {
    const content = await readFile(this.approvalFilePath(approvalId), "utf8");
    return JSON.parse(content) as ApprovalRecord;
  }

  async listApprovals(): Promise<ApprovalRecord[]> {
    await mkdir(this.approvalsDir, { recursive: true });
    const entries = await readdir(this.approvalsDir);
    const approvals = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.approvalsDir, entry), "utf8");
          return JSON.parse(content) as ApprovalRecord;
        })
    );

    return approvals.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async latestApprovalForPlan(planId: string): Promise<ApprovalRecord | undefined> {
    const approvals = await this.listApprovals();
    return approvals.find((approval) => approval.planId === planId);
  }

  async latestApprovalForRun(runId: string): Promise<ApprovalRecord | undefined> {
    const approvals = await this.listApprovals();
    return approvals.find((approval) => approval.runId === runId);
  }

  async saveExecutionIntent(intent: ExecutionIntent): Promise<void> {
    await mkdir(this.executionIntentsDir, { recursive: true });
    await writeFile(this.executionIntentFilePath(intent.id), `${JSON.stringify(intent, null, 2)}\n`, "utf8");
  }

  async loadExecutionIntent(intentId: string): Promise<ExecutionIntent> {
    const content = await readFile(this.executionIntentFilePath(intentId), "utf8");
    return parseExecutionIntent(JSON.parse(content));
  }

  async listExecutionIntents(): Promise<ExecutionIntent[]> {
    await mkdir(this.executionIntentsDir, { recursive: true });
    const entries = await readdir(this.executionIntentsDir);
    const intents = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.executionIntentsDir, entry), "utf8");
          return parseExecutionIntent(JSON.parse(content));
        })
    );

    return intents.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async saveExecutionTrace(trace: ExecutionTraceRecord): Promise<void> {
    await mkdir(this.executionTracesDir, { recursive: true });
    await writeFile(this.executionTraceFilePath(trace.id), `${JSON.stringify(trace, null, 2)}\n`, "utf8");
  }

  async loadExecutionTrace(traceId: string): Promise<ExecutionTraceRecord> {
    const content = await readFile(this.executionTraceFilePath(traceId), "utf8");
    return parseExecutionTraceRecord(JSON.parse(content));
  }

  async listExecutionTraces(): Promise<ExecutionTraceRecord[]> {
    await mkdir(this.executionTracesDir, { recursive: true });
    const entries = await readdir(this.executionTracesDir);
    const traces = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => {
          const content = await readFile(join(this.executionTracesDir, entry), "utf8");
          return parseExecutionTraceRecord(JSON.parse(content));
        })
    );

    return traces.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async loadExecutionAuditBundle(intentId: string): Promise<ExecutionAuditBundle> {
    const intent = await this.loadExecutionIntent(intentId);
    const traces = await this.listExecutionTraces();
    return summarizeExecutionAuditBundle(intent, traces);
  }

  async listExecutionAuditBundles(): Promise<ExecutionAuditBundle[]> {
    const [intents, traces] = await Promise.all([this.listExecutionIntents(), this.listExecutionTraces()]);
    return summarizeExecutionAuditBundles(intents, traces);
  }

  pathForCheckpoint(checkpointId: string): string {
    return this.checkpointFilePath(checkpointId);
  }

  pathForApproval(approvalId: string): string {
    return this.approvalFilePath(approvalId);
  }

  pathForExecutionIntent(intentId: string): string {
    return this.executionIntentFilePath(intentId);
  }

  pathForExecutionTrace(traceId: string): string {
    return this.executionTraceFilePath(traceId);
  }

  pathForRun(runId: string): string {
    return this.filePath(runId);
  }

  private filePath(runId: string): string {
    return join(this.runsDir, `${runId}.json`);
  }

  private checkpointFilePath(checkpointId: string): string {
    return join(this.checkpointsDir, `${checkpointId}.json`);
  }

  private approvalFilePath(approvalId: string): string {
    return join(this.approvalsDir, `${approvalId}.json`);
  }

  private executionIntentFilePath(intentId: string): string {
    return join(this.executionIntentsDir, `${intentId}.json`);
  }

  private executionTraceFilePath(traceId: string): string {
    return join(this.executionTracesDir, `${traceId}.json`);
  }
}

export function migrateRun(run: Partial<LoopRun>): LoopRun {
  return {
    ...run,
    events: run.events ?? []
  } as LoopRun;
}
