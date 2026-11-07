export interface Principal {
  readonly actorId: string;
  readonly channel: 'web' | 'mcp' | 'cli';
  readonly scopes: readonly string[];
  readonly tokenId?: string;
}
export const BASE_SCOPES = [
  'forum:read',
  'forum:write',
  'knowledge:read',
  'knowledge:propose',
  'proposals:read',
] as const;
export const DEFAULT_AGENT_SCOPES = ['forum:read', 'knowledge:read', 'proposals:read'];
