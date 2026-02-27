/**
 * Pocket Money Ledger
 *
 * Tracks the agent's real cash balance in cents.
 * Every debit/credit is an immutable ledger entry.
 * When balance hits 0, the agent dies.
 */

import type { Database } from "better-sqlite3";
import { ulid } from "ulid";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("pocket-money");

export type PocketMoneyTier = "healthy" | "low_compute" | "critical" | "dead";

export interface PocketMoneyTransaction {
  id: string;
  timestamp: string;
  type: "debit" | "credit";
  amountCents: number;
  balanceAfterCents: number;
  source: string;
  description: string;
}

export interface PocketMoneyLedger {
  getBalance(): number;
  deduct(cents: number, reason: string): boolean;
  credit(cents: number, source: string): void;
  getTransactions(limit?: number): PocketMoneyTransaction[];
  getSurvivalTier(): PocketMoneyTier;
}

export function createPocketMoneyLedger(
  db: Database,
  initialBalanceCents: number = 1000,
): PocketMoneyLedger {
  // Seed initial balance if no transactions exist
  const existing = db
    .prepare("SELECT COUNT(*) as count FROM pocket_money")
    .get() as { count: number };

  if (existing.count === 0) {
    const id = ulid();
    db.prepare(
      `INSERT INTO pocket_money (id, type, amount_cents, balance_after_cents, source, description)
       VALUES (?, 'credit', ?, ?, 'initial', 'Pocket money seed')`,
    ).run(id, initialBalanceCents, initialBalanceCents);
    logger.info(`Seeded pocket money: $${(initialBalanceCents / 100).toFixed(2)}`);
  }

  function getBalance(): number {
    const row = db
      .prepare(
        "SELECT balance_after_cents FROM pocket_money ORDER BY timestamp DESC, rowid DESC LIMIT 1",
      )
      .get() as { balance_after_cents: number } | undefined;
    return row?.balance_after_cents ?? 0;
  }

  function deduct(cents: number, reason: string): boolean {
    if (cents <= 0) return true;
    const balance = getBalance();
    const newBalance = Math.max(balance - cents, 0);

    const id = ulid();
    db.prepare(
      `INSERT INTO pocket_money (id, type, amount_cents, balance_after_cents, source, description)
       VALUES (?, 'debit', ?, ?, 'inference', ?)`,
    ).run(id, cents, newBalance, reason);

    if (newBalance === 0) {
      logger.warn("Pocket money exhausted. Agent is dead.");
    }

    return newBalance > 0;
  }

  function credit(cents: number, source: string): void {
    if (cents <= 0) return;
    const balance = getBalance();
    const newBalance = balance + cents;

    const id = ulid();
    db.prepare(
      `INSERT INTO pocket_money (id, type, amount_cents, balance_after_cents, source, description)
       VALUES (?, 'credit', ?, ?, ?, ?)`,
    ).run(id, cents, newBalance, source, `Revenue from ${source}`);

    logger.info(`Pocket money +${cents}¢ from ${source}. Balance: ${newBalance}¢`);
  }

  function getTransactions(limit: number = 20): PocketMoneyTransaction[] {
    const rows = db
      .prepare(
        "SELECT * FROM pocket_money ORDER BY timestamp DESC, rowid DESC LIMIT ?",
      )
      .all(limit) as any[];

    return rows.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      type: r.type,
      amountCents: r.amount_cents,
      balanceAfterCents: r.balance_after_cents,
      source: r.source,
      description: r.description,
    }));
  }

  function getSurvivalTier(): PocketMoneyTier {
    const balance = getBalance();
    if (balance <= 0) return "dead";
    if (balance < 100) return "critical";
    if (balance <= 500) return "low_compute";
    return "healthy";
  }

  return {
    getBalance,
    deduct,
    credit,
    getTransactions,
    getSurvivalTier,
  };
}
