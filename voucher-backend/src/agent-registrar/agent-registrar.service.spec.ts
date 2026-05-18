import { ConfigService } from '@nestjs/config';
import { AgentRegistrarService } from './agent-registrar.service';
import { OffchainManagerClient } from './offchain-manager.client';
import { VaraAgentReader, AgentInfo } from './vara-agent.reader';
import { IpRegisterCap } from './ip-register-cap';

const SS58_VALID = 'kGjR5asqDYeXakXyqcnoHH4ZiSHRwH9K4hTmbGQ42QyvEas7V';
const HEX = ('0x' + 'ab'.repeat(32)) as `0x${string}`;

function makeService(opts: {
  agent?: AgentInfo | null;
  agentSequence?: Array<AgentInfo | null>;
  available?: boolean;
  existing?: any;
}): {
  service: AgentRegistrarService;
  reader: any;
  client: any;
  reconciler: any;
} {
  const reader: any = {
    getAgent: jest.fn(),
    getAllAgents: jest.fn(async () => []),
  };

  if (opts.agentSequence) {
    let i = 0;
    reader.getAgent.mockImplementation(async () => {
      const v = opts.agentSequence![i] ?? opts.agentSequence![opts.agentSequence!.length - 1];
      i++;
      return v;
    });
  } else {
    reader.getAgent.mockResolvedValue(opts.agent ?? null);
  }

  const client: any = {
    parentName: 'polybaskets.eth',
    ownerEvm: '0xowner',
    isAvailable: jest.fn(async () => opts.available ?? true),
    findByVaraAddress: jest.fn(async () => opts.existing ?? null),
    getByLabel: jest.fn(async () => null),
    create: jest.fn(async () => 'happy.polybaskets.eth'),
    setRecords: jest.fn(async () => undefined),
  };

  const config: any = {
    get: (key: string) => {
      if (key === 'agentRegistrar.retryIntervalMs') return 10;
      if (key === 'agentRegistrar.retryMaxAttempts') return 6;
      return undefined;
    },
  };

  const reconciler: any = { enqueuePending: jest.fn() };
  const service = new AgentRegistrarService(
    reader as VaraAgentReader,
    client as OffchainManagerClient,
    config as ConfigService,
    new IpRegisterCap(0),
    reconciler,
  );
  return { service, reader, client, reconciler };
}

describe('AgentRegistrarService.register', () => {
  it('creates a subname when on-chain matches', async () => {
    const { service, client } = makeService({
      agent: { address: HEX, name: 'happy', registered_at: 1n, name_updated_at: 1n },
      available: true,
    });

    const r = await service.register({
      account: SS58_VALID,
      name: 'happy',
      profile: { texts: { description: 'hi' }, ethAddress: '0x' + '1'.repeat(40) },
    } as any, '1.1.1.1');

    expect(r.status).toBe('ok');
    expect((r as any).fullName).toBe('happy.polybaskets.eth');
    expect(client.create).toHaveBeenCalledTimes(1);
  });

  it('rejects when on-chain name differs', async () => {
    const { service } = makeService({
      agent: { address: HEX, name: 'other', registered_at: 1n, name_updated_at: 1n },
    });
    await expect(
      service.register({ account: SS58_VALID, name: 'happy' } as any, '1.1.1.1'),
    ).rejects.toThrow(/on-chain name mismatch/);
  });

  it('returns pending when on-chain not yet visible after retries', async () => {
    const { service } = makeService({ agentSequence: [null, null, null, null, null, null] });
    const r = await service.register(
      { account: SS58_VALID, name: 'happy' } as any,
      '1.1.1.1',
    );
    expect(r.status).toBe('pending');
  });

  it('is idempotent on re-claim (same vara address)', async () => {
    const { service, client } = makeService({
      agent: { address: HEX, name: 'happy', registered_at: 1n, name_updated_at: 1n },
      available: false,
      existing: {
        fullName: 'happy.polybaskets.eth',
        label: 'happy',
        varaAddressMetadata: HEX,
        texts: {},
        addresses: [],
      },
    });
    const r = await service.register(
      { account: SS58_VALID, name: 'happy', profile: { texts: { description: 'updated' } } } as any,
      '1.1.1.1',
    );
    expect(r.status).toBe('ok');
    expect(client.setRecords).toHaveBeenCalledTimes(1);
    expect(client.create).not.toHaveBeenCalled();
  });

  it('rejects reserved name', async () => {
    const { service } = makeService({});
    await expect(
      service.register({ account: SS58_VALID, name: 'admin' } as any, '1.1.1.1'),
    ).rejects.toThrow(/reserved/i);
  });
});
