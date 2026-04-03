/**
 * @solvinghealth/fhir -- FHIR R4 Client
 *
 * Type-safe FHIR R4 client with CRUD operations, search, pagination,
 * batch/transaction support, and configurable authentication.
 *
 * @module @solvinghealth/fhir/client
 * @license MIT
 */

import type {
  FHIRClientConfig,
  FHIRSearchParams,
  PaginatedResult,
  BatchOperation,
  PatchOperation,
  FHIRAuthConfig,
  Bundle,
} from './types.js';
import { BundleSchema, OperationOutcomeSchema } from './types.js';

// ─── Errors ─────────────────────────────────────────────────

/** Error thrown when a FHIR operation fails */
export class FHIRError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly operationOutcome?: unknown,
  ) {
    super(message);
    this.name = 'FHIRError';
  }
}

/** Error thrown when authentication fails or token expires */
export class FHIRAuthError extends FHIRError {
  constructor(message: string) {
    super(message, 401);
    this.name = 'FHIRAuthError';
  }
}

// ─── Token Management ───────────────────────────────────────

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

/**
 * Obtain an OAuth2 access token using the configured auth method.
 * Supports SMART on FHIR (client_credentials) and backend services (JWT assertion).
 */
async function obtainToken(auth: FHIRAuthConfig, _timeout: number): Promise<TokenCache> {
  if (auth.type === 'bearer') {
    return { accessToken: auth.token, expiresAt: Date.now() + 3600_000 };
  }

  if (auth.type === 'basic') {
    const encoded = btoa(`${auth.username}:${auth.password}`);
    return { accessToken: `Basic ${encoded}`, expiresAt: Date.now() + 3600_000 };
  }

  if (auth.type === 'smart') {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: auth.clientId,
      client_secret: auth.clientSecret,
      scope: auth.scopes?.join(' ') ?? 'system/*.read',
    });

    const response = await fetch(auth.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(_timeout),
    });

    if (!response.ok) {
      throw new FHIRAuthError(`Token request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000) - 60_000, // 1min buffer
    };
  }

  if (auth.type === 'backend') {
    // Backend services auth uses JWT assertion (RS384 signed JWT)
    // In production, use jose or jsonwebtoken to create the assertion.
    // For now, we build the assertion parameters for the token endpoint.
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: auth.privateKey, // In production: sign a JWT with the private key
      scope: 'system/*.read system/*.write',
    });

    const response = await fetch(auth.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(_timeout),
    });

    if (!response.ok) {
      throw new FHIRAuthError(`Backend auth failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as { access_token: string; expires_in: number };
    return {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in * 1000) - 60_000,
    };
  }

  throw new FHIRAuthError('Unsupported auth type');
}

// ─── Rate Limiter ───────────────────────────────────────────

class RateLimiter {
  private timestamps: number[] = [];

  constructor(private readonly maxPerMinute: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < 60_000);

    if (this.timestamps.length >= this.maxPerMinute) {
      const oldest = this.timestamps[0]!;
      const waitMs = 60_000 - (now - oldest);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }

    this.timestamps.push(Date.now());
  }
}

// ─── Resource Client ────────────────────────────────────────

/**
 * Type-safe client for a specific FHIR resource type.
 * Provides CRUD operations and search with pagination.
 */
export class ResourceClient<T extends string> {
  constructor(
    private readonly resourceType: T,
    private readonly fhirClient: FHIRClient,
  ) {}

  /**
   * Read a resource by ID.
   * @param id - The resource ID
   * @returns The resource
   * @throws {FHIRError} If the resource is not found or the request fails
   */
  async read(id: string): Promise<Record<string, unknown>> {
    return this.fhirClient.request('GET', `${this.resourceType}/${id}`);
  }

  /**
   * Read a specific version of a resource.
   * @param id - The resource ID
   * @param versionId - The version ID
   * @returns The versioned resource
   */
  async vread(id: string, versionId: string): Promise<Record<string, unknown>> {
    return this.fhirClient.request('GET', `${this.resourceType}/${id}/_history/${versionId}`);
  }

  /**
   * Search for resources matching the given parameters.
   * Returns a paginated result with automatic next/previous page fetching.
   *
   * @param params - FHIR search parameters
   * @returns Paginated result set
   */
  async search(params?: FHIRSearchParams): Promise<PaginatedResult<Record<string, unknown>>> {
    const queryString = params ? buildSearchQuery(params) : '';
    const url = queryString ? `${this.resourceType}?${queryString}` : this.resourceType;
    const bundle = await this.fhirClient.request('GET', url) as Record<string, unknown>;
    return this.fhirClient.parseBundleResult(bundle);
  }

  /**
   * Create a new resource.
   * @param resource - The resource to create (without an ID)
   * @returns The created resource with server-assigned ID
   */
  async create(resource: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.fhirClient.request('POST', this.resourceType, {
      ...resource,
      resourceType: this.resourceType,
    });
  }

  /**
   * Update an existing resource (full replacement).
   * @param id - The resource ID
   * @param resource - The complete resource to store
   * @returns The updated resource
   */
  async update(id: string, resource: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.fhirClient.request('PUT', `${this.resourceType}/${id}`, {
      ...resource,
      resourceType: this.resourceType,
      id,
    });
  }

  /**
   * Patch a resource using JSON Patch operations.
   * @param id - The resource ID
   * @param operations - JSON Patch operations
   * @returns The patched resource
   */
  async patch(id: string, operations: PatchOperation[]): Promise<Record<string, unknown>> {
    return this.fhirClient.request(
      'PATCH',
      `${this.resourceType}/${id}`,
      operations,
      { 'Content-Type': 'application/json-patch+json' },
    );
  }

  /**
   * Delete a resource.
   * @param id - The resource ID
   */
  async delete(id: string): Promise<void> {
    await this.fhirClient.request('DELETE', `${this.resourceType}/${id}`);
  }

  /**
   * Get the history of a resource or all resources of this type.
   * @param id - Optional resource ID. If omitted, returns type-level history.
   * @returns Bundle containing historical versions
   */
  async history(id?: string): Promise<Bundle> {
    const url = id
      ? `${this.resourceType}/${id}/_history`
      : `${this.resourceType}/_history`;
    const result = await this.fhirClient.request('GET', url);
    return BundleSchema.parse(result);
  }
}

// ─── FHIR Client ────────────────────────────────────────────

/**
 * FHIR R4 Client with CRUD operations, search, batch/transaction support,
 * automatic authentication, rate limiting, and retry logic.
 *
 * @example
 * ```typescript
 * const client = new FHIRClient({
 *   baseUrl: 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4',
 *   auth: { type: 'bearer', token: 'my-token' },
 * });
 *
 * const patient = await client.patient.read('123');
 * const results = await client.patient.search({ name: 'Smith', _count: 20 });
 * ```
 */
export class FHIRClient {
  private readonly config: Required<Pick<FHIRClientConfig, 'retries' | 'retryDelay' | 'rateLimit' | 'timeout'>> & FHIRClientConfig;
  private tokenCache: TokenCache | null = null;
  private readonly rateLimiter: RateLimiter;

  /** Resource-specific client for Patient resources */
  public readonly patient: ResourceClient<'Patient'>;
  /** Resource-specific client for Practitioner resources */
  public readonly practitioner: ResourceClient<'Practitioner'>;
  /** Resource-specific client for Encounter resources */
  public readonly encounter: ResourceClient<'Encounter'>;
  /** Resource-specific client for Observation resources */
  public readonly observation: ResourceClient<'Observation'>;
  /** Resource-specific client for Condition resources */
  public readonly condition: ResourceClient<'Condition'>;
  /** Resource-specific client for Procedure resources */
  public readonly procedure: ResourceClient<'Procedure'>;
  /** Resource-specific client for MedicationRequest resources */
  public readonly medicationRequest: ResourceClient<'MedicationRequest'>;
  /** Resource-specific client for DocumentReference resources */
  public readonly documentReference: ResourceClient<'DocumentReference'>;
  /** Resource-specific client for ServiceRequest resources */
  public readonly serviceRequest: ResourceClient<'ServiceRequest'>;

  constructor(config: FHIRClientConfig) {
    this.config = {
      retries: 3,
      retryDelay: 1000,
      rateLimit: 100,
      timeout: 30_000,
      ...config,
    };

    this.rateLimiter = new RateLimiter(this.config.rateLimit);

    this.patient = new ResourceClient('Patient', this);
    this.practitioner = new ResourceClient('Practitioner', this);
    this.encounter = new ResourceClient('Encounter', this);
    this.observation = new ResourceClient('Observation', this);
    this.condition = new ResourceClient('Condition', this);
    this.procedure = new ResourceClient('Procedure', this);
    this.medicationRequest = new ResourceClient('MedicationRequest', this);
    this.documentReference = new ResourceClient('DocumentReference', this);
    this.serviceRequest = new ResourceClient('ServiceRequest', this);
  }

  /**
   * Get a ResourceClient for any FHIR resource type.
   * @param type - The FHIR resource type name
   * @returns A typed ResourceClient
   */
  resource<T extends string>(type: T): ResourceClient<T> {
    return new ResourceClient(type, this);
  }

  /**
   * Execute a batch of operations (independent, all-or-nothing not required).
   * @param operations - Array of batch operations
   * @returns Bundle containing results
   */
  async batch(operations: BatchOperation[]): Promise<Bundle> {
    const bundle = {
      resourceType: 'Bundle' as const,
      type: 'batch' as const,
      entry: operations.map(op => ({
        request: { method: op.method, url: op.url },
        resource: op.resource,
      })),
    };

    const result = await this.request('POST', '', bundle);
    return BundleSchema.parse(result);
  }

  /**
   * Execute a transaction (all-or-nothing, server rolls back on failure).
   * @param operations - Array of transaction operations
   * @returns Bundle containing results
   */
  async transaction(operations: BatchOperation[]): Promise<Bundle> {
    const bundle = {
      resourceType: 'Bundle' as const,
      type: 'transaction' as const,
      entry: operations.map(op => ({
        request: { method: op.method, url: op.url },
        resource: op.resource,
      })),
    };

    const result = await this.request('POST', '', bundle);
    return BundleSchema.parse(result);
  }

  /**
   * Fetch the server's CapabilityStatement (metadata).
   * @returns The CapabilityStatement resource
   */
  async metadata(): Promise<Record<string, unknown>> {
    return this.request('GET', 'metadata');
  }

  /**
   * Make a raw FHIR request with authentication, rate limiting, and retry logic.
   * @internal
   */
  async request(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    await this.rateLimiter.acquire();

    const url = path
      ? `${this.config.baseUrl.replace(/\/$/, '')}/${path}`
      : this.config.baseUrl.replace(/\/$/, '');

    const headers: Record<string, string> = {
      'Accept': 'application/fhir+json',
      ...this.config.headers,
      ...extraHeaders,
    };

    if (body && !extraHeaders?.['Content-Type']) {
      headers['Content-Type'] = 'application/fhir+json';
    }

    // Inject auth header
    const authHeader = await this.getAuthHeader();
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.config.timeout),
        });

        if (response.status === 401 && attempt < this.config.retries) {
          // Token expired; clear cache and retry
          this.tokenCache = null;
          const newAuth = await this.getAuthHeader();
          if (newAuth) {
            headers['Authorization'] = newAuth;
          }
          continue;
        }

        if (response.status === 429 && attempt < this.config.retries) {
          // Rate limited; wait and retry
          const retryAfter = response.headers.get('Retry-After');
          const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.config.retryDelay * (attempt + 1);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        }

        if (response.status === 204 || method === 'DELETE') {
          return {} as Record<string, unknown>;
        }

        const data = await response.json() as Record<string, unknown>;

        if (!response.ok) {
          const outcome = OperationOutcomeSchema.safeParse(data);
          const message = outcome.success
            ? outcome.data.issue.map(i => i.diagnostics ?? i.code).join('; ')
            : `FHIR request failed: ${response.status}`;
          throw new FHIRError(message, response.status, data);
        }

        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof FHIRError) {
          // Don't retry client errors (4xx) except 401 and 429 handled above
          if (error.status >= 400 && error.status < 500) {
            throw error;
          }
        }

        if (attempt < this.config.retries) {
          await new Promise(resolve =>
            setTimeout(resolve, this.config.retryDelay * Math.pow(2, attempt))
          );
        }
      }
    }

    throw lastError ?? new FHIRError('Request failed after retries', 500);
  }

  /**
   * Parse a FHIR Bundle response into a PaginatedResult.
   * @internal
   */
  parseBundleResult(bundle: Record<string, unknown>): PaginatedResult<Record<string, unknown>> {
    const parsed = BundleSchema.safeParse(bundle);

    const entries = parsed.success ? parsed.data.entry : [];
    const total = parsed.success ? parsed.data.total : undefined;
    const links = parsed.success ? parsed.data.link : [];

    const resources = (entries ?? [])
      .filter(e => e.resource != null)
      .map(e => e.resource as Record<string, unknown>);

    const nextLink = links?.find(l => l.relation === 'next');
    const prevLink = links?.find(l => l.relation === 'previous' || l.relation === 'prev');

    const self = this;

    return {
      resources,
      total,
      hasNext: !!nextLink,
      hasPrevious: !!prevLink,
      async next() {
        if (!nextLink) {
          throw new FHIRError('No next page available', 400);
        }
        const result = await self.request('GET', nextLink.url.replace(self.config.baseUrl, ''));
        return self.parseBundleResult(result);
      },
      async previous() {
        if (!prevLink) {
          throw new FHIRError('No previous page available', 400);
        }
        const result = await self.request('GET', prevLink.url.replace(self.config.baseUrl, ''));
        return self.parseBundleResult(result);
      },
    };
  }

  /**
   * Get the Authorization header value, obtaining a token if necessary.
   * @internal
   */
  private async getAuthHeader(): Promise<string | null> {
    const auth = this.config.auth;

    if (auth.type === 'bearer') {
      return `Bearer ${auth.token}`;
    }

    if (auth.type === 'basic') {
      return `Basic ${btoa(`${auth.username}:${auth.password}`)}`;
    }

    // OAuth flows -- use cached token or obtain new one
    if (!this.tokenCache || Date.now() >= this.tokenCache.expiresAt) {
      this.tokenCache = await obtainToken(auth, this.config.timeout);
    }

    return `Bearer ${this.tokenCache.accessToken}`;
  }
}

// ─── Helpers ────────────────────────────────────────────────

/**
 * Build a URL query string from FHIR search parameters.
 * Handles arrays by repeating the parameter.
 */
function buildSearchQuery(params: FHIRSearchParams): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      for (const v of value) {
        parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
      }
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.join('&');
}
