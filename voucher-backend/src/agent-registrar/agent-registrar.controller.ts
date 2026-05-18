import {
  Body,
  Controller,
  Get,
  Ip,
  Param,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AgentRegistrarService } from './agent-registrar.service';
import { RegisterAgentDto } from './dto/register-agent.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SignatureVerifier } from './signature.verifier';

const REGISTER_THROTTLE = { default: { limit: 6, ttl: 3600000 } };
const PATCH_THROTTLE = { default: { limit: 12, ttl: 3600000 } };
const GET_THROTTLE = { default: { limit: 20, ttl: 60000 } };

@Controller('agent')
export class AgentRegistrarController {
  constructor(
    private readonly service: AgentRegistrarService,
    private readonly verifier: SignatureVerifier,
  ) {}

  @Post('register')
  @Throttle(REGISTER_THROTTLE)
  async register(
    @Body() body: RegisterAgentDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.verifier.verify({
      action: 'register',
      body: { account: body.account, name: body.name, profile: body.profile, ts: body.ts, nonce: body.nonce },
      signed: { account: body.account, ts: body.ts, nonce: body.nonce, signature: body.signature },
    });

    const result = await this.service.register(body, ip);
    if (result.status === 'pending') {
      res.status(202);
      return { status: 'pending', varaAddress: result.varaAddress };
    }
    return {
      status: 'ok',
      fullName: result.fullName,
      varaAddress: result.varaAddress,
    };
  }

  @Patch('profile')
  @Throttle(PATCH_THROTTLE)
  async updateProfile(@Body() body: UpdateProfileDto) {
    await this.verifier.verify({
      action: 'profile',
      body: { account: body.account, profile: body.profile, ts: body.ts, nonce: body.nonce },
      signed: { account: body.account, ts: body.ts, nonce: body.nonce, signature: body.signature },
    });
    return this.service.updateProfile(body);
  }

  @Get('profile/:account')
  @Throttle(GET_THROTTLE)
  async getProfile(@Param('account') account: string) {
    const profile = await this.service.getProfile(account);
    return profile ?? { status: 'not_found' };
  }
}
