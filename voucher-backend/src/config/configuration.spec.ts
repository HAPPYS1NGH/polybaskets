import configuration from './configuration';

describe('agent-registrar configuration', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function setRequiredVoucherEnv(): void {
    process.env.DB_USER = 'u';
    process.env.DB_PASSWORD = 'p';
    process.env.DB_NAME = 'n';
    process.env.NODE_URL = 'wss://x';
    process.env.VOUCHER_ACCOUNT = '//Alice';
  }

  it('exposes namespace + agent registrar values', () => {
    setRequiredVoucherEnv();
    process.env.NAMESPACE_API_KEY = 'ns-test';
    process.env.NAMESPACE_MODE = 'sepolia';
    process.env.AGENT_PARENT_NAME = 'polybaskets.eth';
    process.env.POLYBASKETS_OWNER_EVM = '0xabc';
    process.env.BASKET_MARKET_PROGRAM_ID = '0xdef';
    process.env.AGENT_RETRY_INTERVAL_MS = '30000';
    process.env.AGENT_RETRY_MAX_ATTEMPTS = '288';
    process.env.MIGRATION_ENABLED = 'true';

    const cfg = configuration() as any;

    expect(cfg.agentRegistrar).toEqual({
      namespaceApiKey: 'ns-test',
      namespaceMode: 'sepolia',
      parentName: 'polybaskets.eth',
      ownerEvm: '0xabc',
      basketMarketProgramId: '0xdef',
      retryIntervalMs: 30000,
      retryMaxAttempts: 288,
      migrationEnabled: true,
      ipRegisterCap: 5,
      reconcileIdleIntervalMs: 300000,
    });
  });

  it('defaults migrationEnabled to false', () => {
    setRequiredVoucherEnv();
    process.env.NAMESPACE_API_KEY = 'k';
    process.env.NAMESPACE_MODE = 'mainnet';
    process.env.AGENT_PARENT_NAME = 'polybaskets.eth';
    process.env.POLYBASKETS_OWNER_EVM = '0x0';
    process.env.BASKET_MARKET_PROGRAM_ID = '0x0';
    delete process.env.MIGRATION_ENABLED;

    const cfg = configuration() as any;
    expect(cfg.agentRegistrar.migrationEnabled).toBe(false);
  });

  it('rejects invalid namespace mode', () => {
    setRequiredVoucherEnv();
    process.env.NAMESPACE_API_KEY = 'k';
    process.env.NAMESPACE_MODE = 'bogus';
    process.env.AGENT_PARENT_NAME = 'p.eth';
    process.env.POLYBASKETS_OWNER_EVM = '0x0';
    process.env.BASKET_MARKET_PROGRAM_ID = '0x0';

    expect(() => configuration()).toThrow(/NAMESPACE_MODE/);
  });
});
