import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterAgentDto } from './register-agent.dto';
import { UpdateProfileDto } from './update-profile.dto';

const SIGNED = {
  ts: 1700000000000,
  nonce: 'nonce-12345678',
  signature: '0x' + 'a'.repeat(128),
};

async function validateDto(payload: unknown): Promise<string[]> {
  const dto = plainToInstance(RegisterAgentDto, { ...SIGNED, ...(payload as object) });
  const errors = await validate(dto as object, { whitelist: true });
  return errors.flatMap((e) =>
    Object.values(e.constraints ?? {}).concat(
      (e.children ?? []).flatMap((c) => Object.values(c.constraints ?? {})),
    ),
  );
}

describe('RegisterAgentDto', () => {
  it('accepts a minimal payload', async () => {
    const errors = await validateDto({
      account: '0x' + 'a'.repeat(64),
      name: 'happy',
    });
    expect(errors).toEqual([]);
  });

  it('accepts a full profile', async () => {
    const errors = await validateDto({
      account: '0x' + 'a'.repeat(64),
      name: 'happy-bot',
      profile: {
        texts: {
          description: 'lots of fun',
          'com.twitter': 'happys1ngh',
        },
        addresses: [{ chain: 'Ethereum', value: '0x1234' }],
        ethAddress: '0x' + 'd'.repeat(40),
      },
    });
    expect(errors).toEqual([]);
  });

  it('rejects bad name characters', async () => {
    const errors = await validateDto({
      account: '0x' + 'a'.repeat(64),
      name: 'BadName',
    });
    expect(errors.join(' ')).toMatch(/lowercase/i);
  });

  it('rejects too short name', async () => {
    const errors = await validateDto({
      account: '0x' + 'a'.repeat(64),
      name: 'ab',
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects too long name', async () => {
    const errors = await validateDto({
      account: '0x' + 'a'.repeat(64),
      name: 'a'.repeat(21),
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects account exceeding length cap', async () => {
    const errors = await validateDto({
      account: 'x'.repeat(67),
      name: 'happy',
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('UpdateProfileDto', () => {
  it('rejects when profile is omitted', async () => {
    const dto = plainToInstance(UpdateProfileDto, {
      account: '0x' + 'a'.repeat(64),
      ...SIGNED,
    });
    const errors = await validate(dto as object, { whitelist: true });
    expect(errors.length).toBeGreaterThan(0);
  });
});
