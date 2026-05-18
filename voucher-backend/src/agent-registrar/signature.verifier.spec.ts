import { Keyring } from '@polkadot/keyring';
import { cryptoWaitReady, mnemonicGenerate } from '@polkadot/util-crypto';
import { u8aToHex } from '@polkadot/util';
import {
  SignatureVerifier,
  buildSignablePayload,
  canonicalize,
  TIMESTAMP_WINDOW_MS,
} from './signature.verifier';

describe('canonicalize', () => {
  it('sorts keys recursively', () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: [3, 1] } })).toBe(
      '{"a":{"c":[3,1],"d":2},"b":1}',
    );
  });

  it('handles primitives and arrays', () => {
    expect(canonicalize([1, 'x', null])).toBe('[1,"x",null]');
  });
});

describe('SignatureVerifier', () => {
  let alice: any;
  let mallory: any;
  let verifier: SignatureVerifier;

  beforeAll(async () => {
    await cryptoWaitReady();
    const keyring = new Keyring({ type: 'sr25519', ss58Format: 137 });
    alice = keyring.addFromUri('//Alice');
    mallory = keyring.addFromUri('//Mallory');
  });

  beforeEach(() => {
    verifier = new SignatureVerifier();
  });

  function sign(pair: any, action: string, body: Record<string, unknown>): string {
    const message = buildSignablePayload(action, body);
    return u8aToHex(pair.sign(message));
  }

  it('accepts a valid signature', async () => {
    const ts = Date.now();
    const body = { account: alice.address, name: 'happy', ts, nonce: 'n-1234567890' };
    const signature = sign(alice, 'register', body);
    await expect(
      verifier.verify({
        action: 'register',
        body,
        signed: { account: alice.address, ts, nonce: body.nonce, signature },
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects a signature from a different keypair', async () => {
    const ts = Date.now();
    const body = { account: alice.address, name: 'happy', ts, nonce: 'n-2345678901' };
    const signature = sign(mallory, 'register', body);
    await expect(
      verifier.verify({
        action: 'register',
        body,
        signed: { account: alice.address, ts, nonce: body.nonce, signature },
      }),
    ).rejects.toThrow(/signature does not match/i);
  });

  it('rejects stale timestamps', async () => {
    const ts = Date.now() - TIMESTAMP_WINDOW_MS - 1000;
    const body = { account: alice.address, ts, nonce: 'n-3456789012' };
    const signature = sign(alice, 'register', body);
    await expect(
      verifier.verify({
        action: 'register',
        body,
        signed: { account: alice.address, ts, nonce: body.nonce, signature },
      }),
    ).rejects.toThrow(/window/i);
  });

  it('rejects nonce reuse', async () => {
    const ts = Date.now();
    const body = { account: alice.address, ts, nonce: 'n-replay-12345' };
    const signature = sign(alice, 'register', body);
    const signed = { account: alice.address, ts, nonce: body.nonce, signature };
    await verifier.verify({ action: 'register', body, signed });
    await expect(
      verifier.verify({ action: 'register', body, signed }),
    ).rejects.toThrow(/nonce reused/i);
  });

  it('rejects cross-action replay', async () => {
    const ts = Date.now();
    const body = { account: alice.address, ts, nonce: 'n-cross-action-1' };
    const signature = sign(alice, 'profile', body);
    await expect(
      verifier.verify({
        action: 'register',
        body,
        signed: { account: alice.address, ts, nonce: body.nonce, signature },
      }),
    ).rejects.toThrow(/signature does not match/i);
  });
});
