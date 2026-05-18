import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OffchainManagerClient } from './offchain-manager.client';
import { VaraAgentReader, AgentInfo } from './vara-agent.reader';

export type ReconcileSummary = {
  total: number;
  created: number;
  skipped: number;
  failed: number;
};

@Injectable()
export class AgentReconciler implements OnModuleInit {
  private logger = new Logger(AgentReconciler.name);
  private attempts = new Map<string, number>();
  private pending = new Set<string>();
  private maxAttempts: number;
  private idleIntervalMs: number;
  private lastIdleSweepAt = 0;

  constructor(
    private readonly reader: VaraAgentReader,
    private readonly client: OffchainManagerClient,
    private readonly configService: ConfigService,
  ) {
    const configuredMax = this.configService.get<number>('agentRegistrar.retryMaxAttempts');
    this.maxAttempts = typeof configuredMax === 'number' ? configuredMax : 288;
    this.idleIntervalMs =
      this.configService.get<number>('agentRegistrar.reconcileIdleIntervalMs') ?? 300000;
  }

  /**
   * Service registers an agent address (SS58 or hex) when an inline register
   * call fell through to 202 pending — the cron then drains it without
   * scanning all agents.
   */
  enqueuePending(varaAddress: string): void {
    this.pending.add(varaAddress);
  }

  async onModuleInit(): Promise<void> {
    await this.runMigration();
  }

  async runMigration(): Promise<void> {
    const enabled = this.configService.get<boolean>(
      'agentRegistrar.migrationEnabled',
    );
    if (!enabled) return;
    const agents = await this.reader.getAllAgents();
    const summary = await this.reconcileAgents(agents);
    this.logger.log(
      `migration complete: total=${summary.total} created=${summary.created} skipped=${summary.skipped} failed=${summary.failed}`,
    );
  }

  /**
   * Tick strategy:
   * - Migration mode: scan all agents every 30s (one-shot bulk catch-up).
   * - Steady state: drain only the in-memory pending queue every 30s, plus
   *   a slower full-table sweep every `reconcileIdleIntervalMs` (5min default)
   *   as a safety net for failures that bypassed enqueuePending.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async reconcileTick(): Promise<void> {
    try {
      if (this.configService.get<boolean>('agentRegistrar.migrationEnabled')) {
        const agents = await this.reader.getAllAgents();
        await this.reconcileAgents(agents);
        return;
      }

      if (this.pending.size > 0) {
        const drained: AgentInfo[] = [];
        for (const addr of [...this.pending]) {
          try {
            const a = await this.reader.getAgent(addr);
            if (a) drained.push(a);
          } catch (e) {
            this.logger.warn(
              `pending getAgent failed for ${addr}: ${(e as Error).message}`,
            );
          }
        }
        if (drained.length > 0) {
          await this.reconcileAgents(drained);
          for (const a of drained) {
            const summary = await this.client
              .findByVaraAddress(a.address)
              .catch(() => null);
            if (summary?.label === a.name) {
              this.pending.delete(a.address);
            }
          }
        }
      }

      const now = Date.now();
      if (now - this.lastIdleSweepAt >= this.idleIntervalMs) {
        this.lastIdleSweepAt = now;
        const agents = await this.reader.getAllAgents();
        await this.reconcileAgents(agents);
      }
    } catch (e) {
      this.logger.warn(`reconcile tick failed: ${(e as Error).message}`);
    }
  }

  async reconcileAgents(agents: AgentInfo[]): Promise<ReconcileSummary> {
    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const agent of agents) {
      const attempts = (this.attempts.get(agent.address) ?? 0) + 1;
      if (attempts > this.maxAttempts) {
        skipped++;
        continue;
      }

      try {
        const existing = await this.client.findByVaraAddress(agent.address);
        if (existing && existing.label === agent.name) {
          skipped++;
          this.attempts.delete(agent.address);
          continue;
        }
        if (existing && existing.label !== agent.name) {
          // Stale subname (agent renamed on-chain). Don't auto-rewrite from
          // the cron — the agent is expected to call POST /agent/register
          // again. Skip + move on.
          skipped++;
          continue;
        }

        const fullName = `${agent.name}.${this.client.parentName}`;
        const available = await this.client.isAvailable(fullName);
        if (!available) {
          this.logger.warn(
            `cannot reconcile ${agent.address}: subname ${fullName} is taken`,
          );
          skipped++;
          continue;
        }

        await this.client.create({
          label: agent.name,
          texts: { name: agent.name },
          addresses: [{ chain: 'Ethereum', value: this.client.ownerEvm }],
          varaAddress: agent.address,
        });
        created++;
        this.attempts.delete(agent.address);
      } catch (e) {
        this.logger.warn(
          `reconcile failed for ${agent.address}: ${(e as Error).message}`,
        );
        this.attempts.set(agent.address, attempts);
        failed++;
      }
    }

    return { total: agents.length, created, skipped, failed };
  }
}
