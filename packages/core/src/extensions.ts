import type { ConfiguredExtension, ExtensionExecutionContext } from '@mcp-community/extension-api';
import { CORE_API_VERSION } from '@mcp-community/extension-api';
import semver from 'semver';
import { z } from 'zod';
import { AppError } from './errors.js';
import type { Forum } from './forum.js';
import type { Knowledge } from './knowledge.js';
import type { Runtime } from './runtime.js';
import type { Principal } from './types.js';

const extensionId = /^[a-z][a-z0-9-]{0,31}$/;
const toolName = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_EXTENSION_TOOLS = 32;
export interface RegisteredTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly outputSchema: z.ZodObject;
  readonly readOnly: boolean;
  readonly requiredScope: string;
  readonly execute: (input: Record<string, unknown>, principal: Principal) => Promise<unknown>;
}

/** Validate extension descriptors before admitting any scope into the authorization model. */
export function validateExtension(extension: ConfiguredExtension) {
  const { manifest } = extension.extension;
  if (!extensionId.test(manifest.id) || !manifest.name || manifest.name.length > 100)
    throw new Error('Invalid extension id or name');
  if (
    !semver.valid(manifest.version) ||
    !semver.validRange(manifest.coreApi) ||
    !semver.satisfies(CORE_API_VERSION, manifest.coreApi)
  )
    throw new Error(`Incompatible extension: ${manifest.id}`);
  if (
    manifest.permissions.length > MAX_EXTENSION_TOOLS ||
    new Set(manifest.permissions).size !== manifest.permissions.length
  )
    throw new Error(`Invalid permission declaration: ${manifest.id}`);
  for (const scope of manifest.permissions) {
    if (!new RegExp(`^ext:${manifest.id}:[a-z][a-z0-9_]{0,39}$`).test(scope))
      throw new Error(`Invalid extension permission: ${manifest.id}`);
  }
  const result = (manifest.configSchema ?? z.strictObject({})).safeParse(extension.config);
  if (!result.success) throw new Error(`Invalid configuration for extension: ${manifest.id}`);
  return { manifest, config: result.data };
}

export class ExtensionRegistry {
  private readonly registered: RegisteredTool[] = [];
  constructor(
    private readonly rt: Runtime,
    private readonly forum: Forum,
    private readonly knowledge: Knowledge,
    extensions: readonly ConfiguredExtension[],
  ) {
    const seen = new Set<string>();
    for (const entry of extensions) {
      const { manifest, config } = validateExtension(entry);
      if (seen.has(manifest.id)) throw new Error(`Duplicate extension: ${manifest.id}`);
      seen.add(manifest.id);
      const start = this.registered.length;
      entry.extension.register({
        registerTool: (tool) => {
          if (!toolName.test(tool.name)) throw new Error(`Invalid tool name in: ${manifest.id}`);
          const name = `ext_${manifest.id.replaceAll('-', '_')}_${tool.name}`;
          if (this.registered.some((registered) => registered.name === name))
            throw new Error(`Duplicate extension tool: ${name}`);
          if (!manifest.permissions.includes(tool.requiredScope))
            throw new Error(`Tool uses undeclared scope: ${name}`);
          if (this.registered.length - start >= MAX_EXTENSION_TOOLS)
            throw new Error('Too many extension tools');
          if (!tool.inputSchema || !tool.outputSchema)
            throw new Error(`Missing schemas for ${name}`);
          const execute: RegisteredTool['execute'] = async (input, principal) => {
            const actor = this.rt.require(principal, tool.requiredScope);
            if (!tool.readOnly) this.rt.writeRate(actor.id);
            // MCP readOnlyHint must match the behavior of the public service facade.
            // Trusted in-process JS is not sandboxed; this guards the documented API only.
            const mutate = (fn: () => unknown): unknown => {
              if (tool.readOnly)
                throw new AppError(
                  403,
                  'EXTENSION_READ_ONLY',
                  'Read-only extension tools cannot mutate community state',
                );
              return fn();
            };
            const ctx: ExtensionExecutionContext = Object.freeze({
              actor: Object.freeze({ id: actor.id, kind: actor.kind, name: actor.name }),
              config,
              forum: Object.freeze({
                listThreads: (data?: unknown) => this.forum.listThreads(principal, data),
                getThread: (data: unknown) => this.forum.getThread(principal, data),
                createThread: (data: unknown) =>
                  mutate(() => this.forum.createThread(principal, data)),
                reply: (data: unknown) => mutate(() => this.forum.reply(principal, data)),
              }),
              knowledge: Object.freeze({
                list: (data?: unknown) => this.knowledge.list(principal, data),
                get: (data: unknown) => this.knowledge.get(principal, data),
                propose: (data: unknown) => mutate(() => this.knowledge.propose(principal, data)),
              }),
            });
            const parsed = tool.inputSchema.parse(input);
            const output = await tool.execute(parsed, ctx);
            const result = tool.outputSchema.safeParse(output);
            if (!result.success)
              throw new AppError(
                400,
                'INVALID_EXTENSION_OUTPUT',
                'Extension returned invalid output',
              );
            this.rt.audit(actor.id, 'extension.invoke', name);
            return result.data;
          };
          this.registered.push({
            name,
            description: tool.description,
            readOnly: tool.readOnly,
            requiredScope: tool.requiredScope,
            inputSchema: tool.inputSchema,
            outputSchema: tool.outputSchema,
            execute,
          });
        },
      });
    }
  }
  tools(principal: Principal): readonly RegisteredTool[] {
    return this.registered.filter((tool) => principal.scopes.includes(tool.requiredScope));
  }
  tool(name: string): RegisteredTool | undefined {
    return this.registered.find((t) => t.name === name);
  }
}
