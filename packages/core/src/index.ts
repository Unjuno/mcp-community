import type { Database } from '@mcp-community/database';
import type { ConfiguredExtension } from '@mcp-community/extension-api';
import { ExtensionRegistry, validateExtension } from './extensions.js';
import { Forum } from './forum.js';
import { Identity } from './identity.js';
import { Knowledge } from './knowledge.js';
import { Runtime } from './runtime.js';

export { safeEqual } from './crypto.js';
export * from './errors.js';
export * from './extensions.js';
export * from './forum.js';
export type { SessionState } from './identity.js';
export * from './knowledge.js';
export * from './state-machines.js';
export * from './types.js';

export class Community {
  readonly identity: Identity;
  readonly knowledge: Knowledge;
  readonly forum: Forum;
  readonly extensions: ExtensionRegistry;
  readonly runtime: Runtime;
  constructor(
    db: Database,
    options: { now?: () => number; extensions?: readonly ConfiguredExtension[] } = {},
  ) {
    const configured = options.extensions ?? [];
    const scopes = configured.flatMap((entry) => validateExtension(entry).manifest.permissions);
    this.runtime = new Runtime(db, options.now ?? Date.now, scopes);
    this.identity = new Identity(this.runtime);
    this.forum = new Forum(this.runtime);
    this.knowledge = new Knowledge(this.runtime);
    this.extensions = new ExtensionRegistry(this.runtime, this.forum, this.knowledge, configured);
  }
}
