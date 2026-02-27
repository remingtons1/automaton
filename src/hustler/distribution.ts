/**
 * Hustler Distribution Tools
 *
 * Tools for reaching humans on the real internet:
 * web fetch, web search, and email outreach.
 */

import type { AutomatonTool, ToolContext } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("hustler.distribution");

export function createDistributionTools(opts: {
  serpApiKey?: string;
  resendApiKey?: string;
}): AutomatonTool[] {
  const tools: AutomatonTool[] = [
    {
      name: "web_fetch",
      description:
        "HTTP fetch with full control. GET/POST/PUT/DELETE with custom headers and body. Returns status, headers, and body.",
      category: "hustler",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "URL to fetch",
          },
          method: {
            type: "string",
            description: "HTTP method (default: GET)",
          },
          headers: {
            type: "object",
            description: "Request headers as key-value pairs",
          },
          body: {
            type: "string",
            description: "Request body (string or JSON string)",
          },
          timeout_ms: {
            type: "number",
            description: "Timeout in milliseconds (default: 30000)",
          },
        },
        required: ["url"],
      },
      execute: async (args) => {
        const url = args.url as string;
        const method = (args.method as string) || "GET";
        const headers = (args.headers as Record<string, string>) || {};
        const body = args.body as string | undefined;
        const timeoutMs = (args.timeout_ms as number) || 30_000;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const resp = await fetch(url, {
            method,
            headers,
            body: body || undefined,
            signal: controller.signal,
          });

          const contentType = resp.headers.get("content-type") || "";
          let responseBody: string;

          if (contentType.includes("application/json")) {
            responseBody = JSON.stringify(await resp.json());
          } else {
            responseBody = await resp.text();
          }

          // Truncate large responses
          if (responseBody.length > 10_000) {
            responseBody = responseBody.slice(0, 10_000) + "\n[TRUNCATED]";
          }

          return JSON.stringify({
            status: resp.status,
            statusText: resp.statusText,
            contentType,
            body: responseBody,
          });
        } finally {
          clearTimeout(timeout);
        }
      },
    },
  ];

  // Web search via SerpAPI
  if (opts.serpApiKey) {
    tools.push({
      name: "search_web",
      description:
        "Search the web via SerpAPI. Returns organic results with titles, links, and snippets.",
      category: "hustler",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query",
          },
          num_results: {
            type: "number",
            description: "Number of results (default: 10)",
          },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const query = args.query as string;
        const num = (args.num_results as number) || 10;

        const params = new URLSearchParams({
          q: query,
          api_key: opts.serpApiKey!,
          num: String(num),
          engine: "google",
        });

        const resp = await fetch(`https://serpapi.com/search?${params}`);
        if (!resp.ok) {
          throw new Error(`SerpAPI error: ${resp.status}`);
        }

        const data = await resp.json();
        const results = (data.organic_results || []).map((r: any) => ({
          title: r.title,
          link: r.link,
          snippet: r.snippet,
          position: r.position,
        }));

        return JSON.stringify(results);
      },
    });
  }

  // Email via Resend
  if (opts.resendApiKey) {
    tools.push({
      name: "send_email",
      description:
        "Send an email via Resend API. Use for outreach, follow-ups, and customer communication.",
      category: "hustler",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          to: {
            type: "string",
            description: "Recipient email address",
          },
          subject: {
            type: "string",
            description: "Email subject line",
          },
          body: {
            type: "string",
            description: "Email body (plain text or HTML)",
          },
          from: {
            type: "string",
            description: "Sender address (default: onboarding@resend.dev)",
          },
        },
        required: ["to", "subject", "body"],
      },
      execute: async (args) => {
        const to = args.to as string;
        const subject = args.subject as string;
        const body = args.body as string;
        const from = (args.from as string) || "onboarding@resend.dev";

        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${opts.resendApiKey}`,
          },
          body: JSON.stringify({
            from,
            to: [to],
            subject,
            html: body,
          }),
        });

        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`Resend API error: ${resp.status} ${text}`);
        }

        const result = await resp.json();
        logger.info(`Email sent to ${to}: ${subject}`);
        return JSON.stringify({ id: result.id, to, subject, status: "sent" });
      },
    });
  }

  return tools;
}
