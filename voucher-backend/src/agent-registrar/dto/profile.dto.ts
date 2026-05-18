import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Validate,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { ChainName } from '@thenamespace/offchain-manager';

const CHAIN_KEYS = Object.keys(ChainName);
const CHAIN_VALUES = Object.values(ChainName) as string[];
const ALLOWED_CHAINS = [...CHAIN_KEYS, ...CHAIN_VALUES];

export const PROFILE_LIMITS = {
  TEXTS_MAX_ENTRIES: 24,
  TEXT_KEY_MAX: 64,
  TEXT_VALUE_MAX: 512,
  ADDRESS_VALUE_MAX: 256,
};

const TEXT_KEY_RE = /^[a-zA-Z][a-zA-Z0-9._-]{0,63}$/;

@ValidatorConstraint({ name: 'TextsRecord', async: false })
class TextsRecordConstraint implements ValidatorConstraintInterface {
  private reason = 'invalid texts';

  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'object' || Array.isArray(value)) {
      this.reason = 'texts must be an object';
      return false;
    }
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > PROFILE_LIMITS.TEXTS_MAX_ENTRIES) {
      this.reason = `texts may have at most ${PROFILE_LIMITS.TEXTS_MAX_ENTRIES} entries`;
      return false;
    }
    for (const [key, v] of entries) {
      if (!TEXT_KEY_RE.test(key) || key.length > PROFILE_LIMITS.TEXT_KEY_MAX) {
        this.reason = `texts key "${key}" is invalid (letters/digits/._- , <=${PROFILE_LIMITS.TEXT_KEY_MAX} chars)`;
        return false;
      }
      if (v === null) continue;
      if (typeof v !== 'string') {
        this.reason = `texts value for "${key}" must be string or null`;
        return false;
      }
      if (v.length > PROFILE_LIMITS.TEXT_VALUE_MAX) {
        this.reason = `texts value for "${key}" exceeds ${PROFILE_LIMITS.TEXT_VALUE_MAX} chars`;
        return false;
      }
    }
    return true;
  }

  defaultMessage(): string {
    return this.reason;
  }
}

export class ProfileAddressDto {
  @IsString()
  @IsIn(ALLOWED_CHAINS, {
    message: ({ value }) =>
      `unsupported chain "${value}"; allowed values: ${CHAIN_VALUES.join(', ')}`,
  })
  chain: string;

  @IsString()
  @MaxLength(PROFILE_LIMITS.ADDRESS_VALUE_MAX)
  value: string;
}

export class ProfileDto {
  /**
   * ENSIP-5 text records, free-form vocabulary. Format gating only: key
   * shape, capped key/value lengths, capped entry count.
   */
  @IsOptional()
  @IsObject()
  @Validate(TextsRecordConstraint)
  texts?: Record<string, string | null>;

  /** ENSIP-9 multichain addresses. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ProfileAddressDto)
  addresses?: ProfileAddressDto[];

  /**
   * Convenience for the common case — surfaced in STARTER_PROMPT so an
   * agent can supply its EVM address without learning the addresses[] shape.
   * Mapped into addresses[] as { chain: 'Ethereum', value } during processing.
   */
  @IsOptional()
  @IsString()
  @Matches(/^0x[a-fA-F0-9]{40}$/, { message: 'ethAddress must be 0x + 40 hex' })
  ethAddress?: string;
}
