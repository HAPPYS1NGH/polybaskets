import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AgentRegistrarController } from './agent-registrar.controller';
import { AgentRegistrarService } from './agent-registrar.service';
import { OffchainManagerClient } from './offchain-manager.client';
import { VaraAgentReader } from './vara-agent.reader';
import { AgentReconciler } from './agent-reconciler';
import { IpRegisterCap } from './ip-register-cap';
import { SignatureVerifier } from './signature.verifier';

@Module({
  imports: [ConfigModule],
  controllers: [AgentRegistrarController],
  providers: [
    AgentRegistrarService,
    OffchainManagerClient,
    VaraAgentReader,
    AgentReconciler,
    SignatureVerifier,
    {
      provide: IpRegisterCap,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new IpRegisterCap(
          config.get<number>('agentRegistrar.ipRegisterCap') ?? 5,
        ),
    },
  ],
  exports: [],
})
export class AgentRegistrarModule {}
