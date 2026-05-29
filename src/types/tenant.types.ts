export interface TenantContext {
  tenantId: string;
  tin: string;
  registeredName: string;
  plan: 'STARTER' | 'PROFESSIONAL' | 'ENTERPRISE';
  status: 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'CANCELLED';
}

export interface UserContext {
  userId: string;
  tenantId: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'ACCOUNTANT' | 'VIEWER';
}

export interface ApiKeyContext {
  apiKeyId: string;
  tenantId: string;
  scopes: string[];
}

export type AuthContext =
  | { type: 'user'; user: UserContext; tenant: TenantContext }
  | { type: 'apiKey'; apiKey: ApiKeyContext; tenant: TenantContext };

export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor?: string;
  total?: number;
}
