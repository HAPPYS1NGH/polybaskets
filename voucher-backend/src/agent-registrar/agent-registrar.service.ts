import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { decodeAddress, HexString } from '@gear-js/api';
import { VaraAgentReader, AgentInfo } from './vara-agent.reader';
import {
  OffchainManagerClient,
  Address,
  Texts,
} from './offchain-manager.client';
import { IpRegisterCap } from './ip-register-cap';
import { isNameAllowed } from './name-rules';
import { ProfileDto } from './dto/profile.dto';
import { RegisterAgentDto } from './dto/register-agent.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { AgentReconciler } from './agent-reconciler';

export type RegisterResult =
  | { status: 'ok'; fullName: string; varaAddress: HexString }
  | { status: 'pending'; varaAddress: HexString };

@Injectable()
export class AgentRegistrarService {
  private logger = new Logger(AgentRegistrarService.name);

  constructor(
    private readonly reader: VaraAgentReader,
    private readonly client: OffchainManagerClient,
    private readonly configService: ConfigService,
    private readonly ipCap: IpRegisterCap,
    private readonly reconciler: AgentReconciler,
  ) {}

  async register(dto: RegisterAgentDto, ip: string): Promise<RegisterResult> {
    if (!isNameAllowed(dto.name)) {
      throw new BadRequestException(`name "${dto.name}" is invalid or reserved`);
    }

    const account = this.decode(dto.account);

    const reservation = this.ipCap.tryReserve(ip);
    if (!reservation.ok) {
      throw new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message: 'Daily agent register cap exceeded for this IP',
          retryAfterSec: (reservation as { ok: false; retryAfterSec: number }).retryAfterSec,
        },
        429,
      );
    }

    const onChain = await this.pollGetAgent(dto.account);
    if (!onChain) {
      this.logger.log(`pending finality for ${account} -> 202`);
      this.reconciler.enqueuePending(dto.account);
      return { status: 'pending', varaAddress: account };
    }

    if (onChain.name !== dto.name) {
      throw new ConflictException(
        `on-chain name mismatch (got "${onChain.name}")`,
      );
    }

    return await this.upsertSubname(account, dto.name, dto.profile);
  }

  async updateProfile(dto: UpdateProfileDto): Promise<{ fullName: string }> {
    const account = this.decode(dto.account);

    const onChain = await this.reader.getAgent(dto.account);
    if (!onChain) {
      throw new ConflictException('agent not registered on-chain');
    }

    const summary = await this.client.findByVaraAddress(account);
    if (!summary) {
      throw new ConflictException(
        'no subname for this account; call POST /agent/register first',
      );
    }

    if (summary.label !== onChain.name) {
      throw new ConflictException(
        `stale subname (label "${summary.label}" != on-chain "${onChain.name}"); call POST /agent/register first`,
      );
    }

    const { texts, addresses } = this.buildRecords(dto.profile, account, summary.label);
    await this.client.setRecords({ fullName: summary.fullName, texts, addresses });
    return { fullName: summary.fullName };
  }

  async getProfile(accountSs58: string): Promise<{
    fullName: string;
    name: string;
    texts: Record<string, string>;
    addresses: Address[];
    varaAddress: string;
  } | null> {
    const account = this.decode(accountSs58);
    const summary = await this.client.findByVaraAddress(account);
    if (!summary) return null;
    return {
      fullName: summary.fullName,
      name: summary.label,
      texts: summary.texts,
      addresses: summary.addresses,
      varaAddress: account,
    };
  }

  /**
   * Idempotent upsert: creates the subname if free, updates records if the
   * subname already belongs to this Vara address, or rejects with 409 if
   * another account holds it.
   */
  private async upsertSubname(
    account: HexString,
    label: string,
    profile: ProfileDto | undefined,
  ): Promise<RegisterResult> {
    const fullName = `${label}.${this.client.parentName}`;
    const available = await this.client.isAvailable(fullName);
    const { texts, addresses } = this.buildRecords(profile ?? {}, account, label);

    if (available) {
      const created = await this.client.create({
        label,
        texts,
        addresses,
        varaAddress: account,
      });
      return { status: 'ok', fullName: created, varaAddress: account };
    }

    const owned = await this.client.findByVaraAddress(account);
    if (owned && owned.label === label) {
      await this.client.setRecords({ fullName: owned.fullName, texts, addresses });
      return { status: 'ok', fullName: owned.fullName, varaAddress: account };
    }
    throw new ConflictException('subname taken by another account');
  }

  private buildRecords(
    profile: ProfileDto,
    account: HexString,
    label: string,
  ): { texts: Texts; addresses: Address[] } {
    const texts: Texts = { name: label, ...(profile.texts ?? {}) };
    const addresses: Address[] = [...(profile.addresses ?? [])];
    if (profile.ethAddress) {
      addresses.push({ chain: 'Ethereum', value: profile.ethAddress });
    }
    if (addresses.length === 0) {
      addresses.push({ chain: 'Ethereum', value: this.client.ownerEvm });
    }
    return { texts, addresses };
  }

  private decode(accountSs58: string): HexString {
    try {
      return decodeAddress(accountSs58) as HexString;
    } catch {
      throw new BadRequestException('Invalid account address');
    }
  }

  private async pollGetAgent(ss58: string): Promise<AgentInfo | null> {
    const intervalMs = this.configService.get<number>(
      'agentRegistrar.retryIntervalMs',
    ) ?? 30000;
    const cfgMax = this.configService.get<number>(
      'agentRegistrar.retryMaxAttempts',
    ) ?? 1;
    // Cap inline polling at 60s; reconciler handles longer waits.
    const maxAttempts = Math.max(1, Math.min(cfgMax, Math.ceil(60_000 / intervalMs)));

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const a = await this.reader.getAgent(ss58);
        if (a) return a;
      } catch (e) {
        this.logger.warn(`getAgent failed during poll: ${(e as Error).message}`);
      }
      if (i < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    }
    return null;
  }
}
