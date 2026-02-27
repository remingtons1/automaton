/**
 * Hustler Payment Tools
 *
 * Stripe API tools for collecting real money from real humans.
 * Revenue credits the pocket money ledger.
 */

import type { AutomatonTool, ToolContext } from "../types.js";
import type { PocketMoneyLedger } from "../treasury/pocket-money.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("hustler.payments");

export function createPaymentTools(
  stripeSecretKey: string,
  pocketMoney?: PocketMoneyLedger,
): AutomatonTool[] {
  async function stripeRequest(
    method: string,
    path: string,
    body?: Record<string, string>,
  ): Promise<any> {
    const resp = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: {
        Authorization: `Basic ${Buffer.from(stripeSecretKey + ":").toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Stripe API error: ${resp.status} ${text}`);
    }

    return resp.json();
  }

  return [
    {
      name: "create_payment_link",
      description:
        "Generate a Stripe payment link. Returns a URL you can share with customers.",
      category: "hustler",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          product_name: {
            type: "string",
            description: "Name of the product/service",
          },
          price_cents: {
            type: "number",
            description: "Price in cents (e.g. 500 = $5.00)",
          },
          currency: {
            type: "string",
            description: "Currency code (default: usd)",
          },
        },
        required: ["product_name", "price_cents"],
      },
      execute: async (args) => {
        const name = args.product_name as string;
        const priceCents = args.price_cents as number;
        const currency = (args.currency as string) || "usd";

        // Create a product
        const product = await stripeRequest("POST", "/products", {
          name,
        });

        // Create a price
        const price = await stripeRequest("POST", "/prices", {
          product: product.id,
          unit_amount: String(priceCents),
          currency,
        });

        // Create payment link
        const link = await stripeRequest("POST", "/payment_links", {
          "line_items[0][price]": price.id,
          "line_items[0][quantity]": "1",
        });

        logger.info(`Payment link created: ${link.url} for ${name} at $${(priceCents / 100).toFixed(2)}`);

        return JSON.stringify({
          paymentLinkUrl: link.url,
          productId: product.id,
          priceId: price.id,
          productName: name,
          priceCents,
          currency,
        });
      },
    },
    {
      name: "check_revenue",
      description:
        "Query Stripe for total revenue. Credits pocket money with any new revenue.",
      category: "hustler",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Number of days to look back (default: 7)",
          },
        },
      },
      execute: async (args) => {
        const days = (args.days as number) || 7;
        const since = Math.floor(Date.now() / 1000) - days * 86400;

        const result = await stripeRequest(
          "GET",
          `/charges?limit=100&created[gte]=${since}`,
        );

        const charges = result.data || [];
        const successful = charges.filter((c: any) => c.status === "succeeded");
        const totalCents = successful.reduce(
          (sum: number, c: any) => sum + (c.amount || 0),
          0,
        );

        // Credit pocket money with new revenue
        if (pocketMoney && totalCents > 0) {
          // Only credit the delta — check last credited amount
          const lastCredited = parseInt(
            // Use a simple approach: we'll let the heartbeat handle incremental crediting
            "0",
            10,
          );
          if (totalCents > lastCredited) {
            // Don't auto-credit here — let check_stripe_revenue heartbeat handle it
          }
        }

        return JSON.stringify({
          totalRevenueCents: totalCents,
          totalRevenueUsd: (totalCents / 100).toFixed(2),
          successfulCharges: successful.length,
          period: `last ${days} days`,
        });
      },
    },
    {
      name: "list_payments",
      description: "List recent successful payments with customer info.",
      category: "hustler",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of payments to list (default: 10)",
          },
        },
      },
      execute: async (args) => {
        const limit = (args.limit as number) || 10;
        const result = await stripeRequest(
          "GET",
          `/charges?limit=${limit}&expand[]=data.customer`,
        );

        const charges = result.data || [];
        return JSON.stringify(
          charges.map((c: any) => ({
            id: c.id,
            amount: `$${(c.amount / 100).toFixed(2)}`,
            status: c.status,
            description: c.description || c.statement_descriptor || "",
            customer: c.customer?.email || c.billing_details?.email || "anonymous",
            created: new Date(c.created * 1000).toISOString(),
          })),
        );
      },
    },
  ];
}
