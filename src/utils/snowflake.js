/**
 * Snowflake ID Generator
 * 
 * Generates unique 64-bit IDs without database coordination.
 * Structure (64 bits total):
 *   - 1 bit:  unused (sign)
 *   - 41 bits: timestamp (ms since custom epoch) — ~69 years
 *   - 10 bits: machine ID (0-1023)
 *   - 12 bits: sequence number (0-4095 per ms)
 * 
 * This guarantees uniqueness across distributed nodes.
 */

const CUSTOM_EPOCH = 1704067200000n; // 2026-01-01T00:00:00Z
const MACHINE_BITS = 10n;
const SEQUENCE_BITS = 12n;

const MAX_MACHINE_ID = (1n << MACHINE_BITS) - 1n;
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;

const MACHINE_SHIFT = SEQUENCE_BITS;
const TIMESTAMP_SHIFT = SEQUENCE_BITS + MACHINE_BITS;

class SnowflakeGenerator {
  constructor(machineId = 1) {
    const mid = BigInt(machineId);
    if (mid < 0n || mid > MAX_MACHINE_ID) {
      throw new Error(`Machine ID must be between 0 and ${MAX_MACHINE_ID}`);
    }
    this.machineId = mid;
    this.sequence = 0n;
    this.lastTimestamp = -1n;
  }

  _currentTimestamp() {
    return BigInt(Date.now()) - CUSTOM_EPOCH;
  }

  _waitNextMs(lastTs) {
    let ts = this._currentTimestamp();
    while (ts <= lastTs) {
      ts = this._currentTimestamp();
    }
    return ts;
  }

  generate() {
    let timestamp = this._currentTimestamp();

    if (timestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
      if (this.sequence === 0n) {
        // Sequence exhausted for this ms — wait for next ms
        timestamp = this._waitNextMs(this.lastTimestamp);
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = timestamp;

    const id =
      (timestamp << TIMESTAMP_SHIFT) |
      (this.machineId << MACHINE_SHIFT) |
      this.sequence;

    return id;
  }
}

module.exports = SnowflakeGenerator;
