import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { signatureVerify, cryptoWaitReady } from '@polkadot/util-crypto';

export const SIGNATURE_DOMAIN = 'polybaskets-agent-registrar';
export const SIGNATURE_VERSION = 1;
export const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000;

export type SignedFields = {
  account: string;
  ts: number;
  nonce: string;
  signature: string;
};

/**
 * Canonical JSON: keys sorted recursively, no whitespace. Both signer and
 * verifier must produce byte-identical output for the signature to match.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys
      .map(
        (k) =>
          JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

/**
 * Build the message bytes that the agent must sign. We bind the action name
 * to prevent a /agent/profile signature from being replayed against
 * /agent/register (and vice versa).
 */
export function buildSignablePayload(action: string, body: Record<string, unknown>): string {
  const { signature: _drop, ...rest } = body as Record<string, unknown> & { signature?: unknown };
  return canonicalize({
    domain: SIGNATURE_DOMAIN,
    version: SIGNATURE_VERSION,
    action,
    body: rest,
  });
}

@Injectable()
export class SignatureVerifier {
  private replay = new Map<string, number>();
  private ready: Promise<unknown> | null = null;

  /**
   * Validates timestamp freshness, nonce uniqueness, and SR25519/ED25519
   * signature against the SS58 account. Throws 400 for shape errors and
   * 401 for cryptographic failure.
   */
  async verify(opts: {
    action: string;
    body: Record<string, unknown>;
    signed: SignedFields;
  }): Promise<void> {
    const { action, body, signed } = opts;

    if (!signed.signature || !signed.nonce || !signed.ts) {
      throw new BadRequestException('signature, nonce, ts are required');
    }
    if (typeof signed.ts !== 'number' || !Number.isFinite(signed.ts)) {
      throw new BadRequestException('ts must be a unix-ms number');
    }
    const skew = Math.abs(Date.now() - signed.ts);
    if (skew > TIMESTAMP_WINDOW_MS) {
      throw new UnauthorizedException(
        `ts outside ±${TIMESTAMP_WINDOW_MS / 1000}s window`,
      );
    }

    const replayKey = `${signed.account}:${signed.nonce}`;
    if (this.replay.has(replayKey)) {
      throw new UnauthorizedException('nonce reused');
    }

    if (!this.ready) this.ready = cryptoWaitReady();
    await this.ready;

    const message = buildSignablePayload(action, body);
    let result;
    try {
      result = signatureVerify(message, signed.signature, signed.account);
    } catch (e) {
      throw new UnauthorizedException(`signature decode failed: ${(e as Error).message}`);
    }
    if (!result.isValid) {
      throw new UnauthorizedException('signature does not match account');
    }

    this.recordNonce(replayKey);
  }

  private recordNonce(key: string): void {
    const now = Date.now();
    this.replay.set(key, now);
    if (this.replay.size > 10000) {
      const cutoff = now - TIMESTAMP_WINDOW_MS;
      for (const [k, v] of this.replay) if (v < cutoff) this.replay.delete(k);
    }
  }
}
