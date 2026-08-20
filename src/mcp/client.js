/**
 * MCP client wrapper. Spawns the RouteStack MCP Server as a child process
 * over stdio and exposes its tools through one plain async function, so the
 * orchestrator never needs to know RouteStack access is implemented as a
 * separate MCP server - it only sees "call this tool, get this result."
 *
 * A broken connection is retried exactly once (a fresh reconnect); if that
 * also fails, callers get a McpUnavailableError instead of a fabricated
 * success.
 *
 * Note: the MCP SDK's stdio transport does NOT inherit the parent's full
 * environment by default (it only passes a small safe allowlist). The
 * RouteStack server needs ROUTESTACK_*, so `env` is passed through
 * explicitly below - this is our own local server, not a third-party one,
 * so there's no isolation reason to withhold it.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, "routeStackServer.js");

export class McpUnavailableError extends Error {}

let client = null;
let connecting = null;

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_PATH],
    env: process.env,
    stderr: "pipe",
  });
  const c = new Client({ name: "stayora", version: "0.1.0" });
  await c.connect(transport);
  return c;
}

async function getClient() {
  if (client) return client;
  if (!connecting) {
    connecting = connect()
      .then((c) => {
        client = c;
        connecting = null;
        return c;
      })
      .catch((err) => {
        connecting = null;
        throw err;
      });
  }
  return connecting;
}

async function resetConnection() {
  const closing = client;
  client = null;
  connecting = null;
  try {
    await closing?.close?.();
  } catch {
    // ignore - we're already discarding this connection
  }
}

/**
 * Calls a tool on the RouteStack MCP Server, retrying once on any transport
 * failure with a fresh connection.
 *
 * @param {string} name Tool name, e.g. "search_hotels".
 * @param {object} args Tool arguments.
 * @param {object} [options]
 * @param {object} [options.metrics] Accumulator - increments mcpCalls/mcpMs.
 * @returns {Promise<{ text: string, isError: boolean }>}
 */
export async function callRouteStackTool(name, args, options = {}) {
  const { metrics } = options;
  const start = Date.now();

  const attempt = async () => {
    const c = await getClient();
    const result = await c.callTool({ name, arguments: args });
    const text = result.content?.map((block) => block.text ?? "").join("\n") ?? "";
    return { text, isError: Boolean(result.isError) };
  };

  try {
    const result = await attempt();
    if (metrics) {
      metrics.mcpCalls = (metrics.mcpCalls || 0) + 1;
      metrics.mcpMs = (metrics.mcpMs || 0) + (Date.now() - start);
    }
    return result;
  } catch (err) {
    if (metrics) metrics.retryCount = (metrics.retryCount || 0) + 1;
    await resetConnection();
    try {
      const result = await attempt();
      if (metrics) {
        metrics.mcpCalls = (metrics.mcpCalls || 0) + 1;
        metrics.mcpMs = (metrics.mcpMs || 0) + (Date.now() - start);
      }
      return result;
    } catch (retryErr) {
      await resetConnection();
      throw new McpUnavailableError(
        `RouteStack MCP server is unavailable after a retry: ${retryErr.message}`
      );
    }
  }
}

/** Closes the MCP connection (used on server shutdown / one-shot scripts). */
export async function closeMcpClient() {
  await resetConnection();
}
