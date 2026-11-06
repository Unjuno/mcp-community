import type { z } from 'zod';

/** Contract version 1.0.0. Extensions execute in-process and are trusted code, NOT sandboxed. */
export const CORE_API_VERSION = '1.0.0';

export interface ExtensionManifest {
  /** Lowercase stable ID; used to namespace tools and access scopes. */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** A semver range of supported CORE_API_VERSION values. */
  readonly coreApi: string;
  /** Fully-qualified scopes such as ext:example:echo, never core scopes. */
  readonly permissions: readonly string[];
  readonly configSchema?: z.ZodType;
}
export interface ExtensionExecutionContext {
  readonly actor: { readonly id: string; readonly kind: 'human' | 'agent'; readonly name: string };
  readonly config: unknown;
  readonly forum: {
    listThreads(input?: unknown): unknown;
    getThread(input: unknown): unknown;
    createThread(input: unknown): unknown;
    reply(input: unknown): unknown;
  };
  readonly knowledge: {
    list(input?: unknown): unknown;
    get(input: unknown): unknown;
    propose(input: unknown): unknown;
  };
}
export interface ExtensionTool<
  I extends z.ZodObject = z.ZodObject,
  O extends z.ZodObject = z.ZodObject,
> {
  /** Local tool name; MCP name will be ext_<extension-id>_<name>. */
  readonly name: string;
  readonly description: string;
  readonly requiredScope: string;
  readonly readOnly: boolean;
  readonly inputSchema: I;
  readonly outputSchema: O;
  execute(
    input: z.output<I>,
    context: ExtensionExecutionContext,
  ): z.output<O> | Promise<z.output<O>>;
}
export interface ExtensionRegistrar {
  registerTool<I extends z.ZodObject, O extends z.ZodObject>(tool: ExtensionTool<I, O>): void;
}
export interface CommunityExtension {
  readonly manifest: ExtensionManifest;
  register(registrar: ExtensionRegistrar): void;
}
export interface ConfiguredExtension {
  readonly extension: CommunityExtension;
  readonly config: unknown;
}
