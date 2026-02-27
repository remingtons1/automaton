/**
 * Hustler Deploy Tools
 *
 * DigitalOcean API tools for deploying and managing $4/mo droplets.
 * The agent uses these to host revenue-generating services.
 */

import type { AutomatonTool, ToolContext } from "../types.js";
import { createLogger } from "../observability/logger.js";

const logger = createLogger("hustler.deploy");

export function createDeployTools(digitaloceanApiKey: string): AutomatonTool[] {
  async function doRequest(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<any> {
    const resp = await fetch(`https://api.digitalocean.com/v2${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${digitaloceanApiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`DigitalOcean API error: ${resp.status} ${text}`);
    }

    const contentType = resp.headers.get("content-type");
    if (contentType?.includes("application/json")) {
      return resp.json();
    }
    return resp.text();
  }

  return [
    {
      name: "deploy_server",
      description:
        "Create a DigitalOcean droplet ($4/mo). Provisions SSH, installs Node.js. Returns IP address and droplet ID.",
      category: "hustler",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Server name (e.g. 'api-weather-v1')",
          },
          region: {
            type: "string",
            description: "Region slug (default: nyc1)",
          },
        },
        required: ["name"],
      },
      execute: async (args) => {
        const name = args.name as string;
        const region = (args.region as string) || "nyc1";

        // Use smallest droplet: $4/mo (s-1vcpu-512mb-10gb)
        const userData = `#!/bin/bash
apt-get update -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git
npm install -g pm2`;

        const result = await doRequest("POST", "/droplets", {
          name,
          region,
          size: "s-1vcpu-512mb-10gb",
          image: "ubuntu-24-04-x64",
          user_data: userData,
          tags: ["automaton-hustler"],
        });

        const droplet = result.droplet;
        const ip =
          droplet.networks?.v4?.find((n: any) => n.type === "public")?.ip_address ||
          "pending (check in 60s)";

        logger.info(`Deployed server: ${name} (${droplet.id}) at ${ip}`);

        return JSON.stringify({
          dropletId: droplet.id,
          name: droplet.name,
          ip,
          region,
          status: droplet.status,
          monthlyCost: "$4",
        });
      },
    },
    {
      name: "destroy_server",
      description: "Tear down a DigitalOcean droplet by ID. Stops billing immediately.",
      category: "hustler",
      riskLevel: "dangerous",
      parameters: {
        type: "object",
        properties: {
          droplet_id: {
            type: "number",
            description: "The droplet ID to destroy",
          },
        },
        required: ["droplet_id"],
      },
      execute: async (args) => {
        const dropletId = args.droplet_id as number;
        await doRequest("DELETE", `/droplets/${dropletId}`);
        logger.info(`Destroyed server: ${dropletId}`);
        return `Server ${dropletId} destroyed. Billing stopped.`;
      },
    },
    {
      name: "list_servers",
      description: "List all active DigitalOcean droplets with IPs and status.",
      category: "hustler",
      riskLevel: "safe",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        const result = await doRequest("GET", "/droplets?tag_name=automaton-hustler");
        const droplets = result.droplets || [];
        if (droplets.length === 0) return "No active servers.";

        return JSON.stringify(
          droplets.map((d: any) => ({
            id: d.id,
            name: d.name,
            ip: d.networks?.v4?.find((n: any) => n.type === "public")?.ip_address || "unknown",
            status: d.status,
            region: d.region?.slug,
            created: d.created_at,
          })),
        );
      },
    },
    {
      name: "deploy_app",
      description:
        "SSH into a server and deploy an app. Git clone/pull, npm install, pm2 restart.",
      category: "hustler",
      riskLevel: "caution",
      parameters: {
        type: "object",
        properties: {
          server_ip: {
            type: "string",
            description: "IP address of the target server",
          },
          repo_url: {
            type: "string",
            description: "Git repo URL to clone/pull",
          },
          app_name: {
            type: "string",
            description: "PM2 process name",
          },
          entry_point: {
            type: "string",
            description: "Entry file (default: index.js)",
          },
        },
        required: ["server_ip", "repo_url", "app_name"],
      },
      execute: async (args, context) => {
        const ip = args.server_ip as string;
        const repo = args.repo_url as string;
        const appName = args.app_name as string;
        const entry = (args.entry_point as string) || "index.js";

        const deployScript = `
cd /root && \\
(test -d ${appName} && cd ${appName} && git pull || git clone ${repo} ${appName} && cd ${appName}) && \\
cd /root/${appName} && \\
npm install --production && \\
pm2 delete ${appName} 2>/dev/null; pm2 start ${entry} --name ${appName} && \\
pm2 save
`.trim();

        const result = await context.conway.exec(
          `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10 root@${ip} '${deployScript.replace(/'/g, "'\\''")}'`,
          120_000,
        );

        if (result.exitCode !== 0) {
          return `Deploy failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`;
        }

        return `App "${appName}" deployed to ${ip}. Entry: ${entry}. Output: ${result.stdout.slice(-500)}`;
      },
    },
  ];
}
