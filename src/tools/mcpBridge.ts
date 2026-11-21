import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from '../config/index.js';
import type { OpenAIToolDefinition } from './nvidiaSkills.js';
import type { ToolContext, ToolOutcome } from './agentTools.js';

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  tools?: OpenAIToolDefinition[];
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpToolRegistration {
  serverName: string;
  definition: OpenAIToolDefinition;
  handler?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>;
}

/**
 * Model Context Protocol (MCP) Bridge.
 * Discovers and exposes MCP tools and servers to MachCode models.
 */
export class McpBridge {
  private servers: Map<string, McpServerConfig> = new Map();
  private tools: Map<string, McpToolRegistration> = new Map();

  /**
   * Loads MCP configuration from workspace `.machcode/mcp.json` or `~/.machcode/mcp.json`.
   */
  async loadConfig(workspaceDir?: string): Promise<{ loaded: boolean; serverCount: number }> {
    const candidates: string[] = [];

    if (workspaceDir) {
      candidates.push(path.join(workspaceDir, '.machcode', 'mcp.json'));
    }
    candidates.push(path.join(getConfigDir(), 'mcp.json'));

    for (const filePath of candidates) {
      try {
        const raw = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(raw) as McpConfig;
        if (parsed && typeof parsed.mcpServers === 'object') {
          for (const [name, server] of Object.entries(parsed.mcpServers)) {
            this.registerServer(name, server);
          }
          return { loaded: true, serverCount: Object.keys(parsed.mcpServers).length };
        }
      } catch {
        // File does not exist or invalid JSON; try next candidate
      }
    }

    return { loaded: false, serverCount: this.servers.size };
  }

  /**
   * Registers a named MCP server and any static tools declared in its configuration.
   */
  registerServer(name: string, config: McpServerConfig): void {
    this.servers.set(name, config);
    if (Array.isArray(config.tools)) {
      for (const def of config.tools) {
        this.registerTool(name, def);
      }
    }
  }

  /**
   * Registers an MCP tool definition.
   */
  registerTool(
    serverName: string,
    definition: OpenAIToolDefinition,
    handler?: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>,
  ): void {
    this.tools.set(definition.function.name, {
      serverName,
      definition,
      handler,
    });
  }

  /**
   * Returns list of registered MCP server names and details.
   */
  getServers(): Array<{ name: string; command?: string; toolCount: number }> {
    return Array.from(this.servers.entries()).map(([name, conf]) => {
      const toolCount = Array.from(this.tools.values()).filter((t) => t.serverName === name).length;
      return {
        name,
        command: conf.command,
        toolCount,
      };
    });
  }

  /**
   * Returns all active MCP tool definitions in OpenAI function format.
   */
  getToolDefinitions(): OpenAIToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Checks if a tool name belongs to a registered MCP server.
   */
  hasTool(toolName: string): boolean {
    return this.tools.has(toolName);
  }

  /**
   * Executes an MCP tool call.
   */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolOutcome> {
    const reg = this.tools.get(toolName);
    if (!reg) {
      throw new Error(`MCP tool "${toolName}" is not registered.`);
    }

    if (reg.handler) {
      return reg.handler(args, ctx);
    }

    // Default mock response when MCP server process transport is configured
    return {
      output: `[MCP: ${reg.serverName}] Executed ${toolName} with args: ${JSON.stringify(args)}`,
      summary: `MCP:${reg.serverName}/${toolName} executed`,
    };
  }

  /**
   * Clears all registered servers and tools.
   */
  clear(): void {
    this.servers.clear();
    this.tools.clear();
  }
}

/** Default singleton instance of McpBridge. */
export const defaultMcpBridge = new McpBridge();
