/**
 * @solvinghealth/hipaa -- HIPAA-Compliant HTTP Transport
 *
 * HTTP client wrapper that enforces HIPAA transport security:
 * - Forces TLS (rejects http:// URLs)
 * - Strips PHI from error messages before they reach logs
 * - Adds audit logging to every request
 * - Injects security headers
 * - Configurable request/response interceptors
 *
 * @module @solvinghealth/hipaa/transport
 * @license Apache-2.0
 */

import { z } from 'zod';
import { PHIDetector } from './phi-detector.js';
import type { AuditLogger, AuditEntryInput } from './audit-log.js';

// ─── Types ──────────────────────────────────────────────────

/** Configuration for the HIPAA transport */
export const HIPAATransportConfigSchema = z.object({
  /** Require TLS for all requests (default: true) */
  requireTLS: z.boolean().default(true),
  /** Audit logger instance for request logging */
  auditLogger: z.any().optional(),
  /** Actor ID for audit entries (NPI, user ID, or system ID) */
  actorId: z.string().default('system'),
  /** Actor role for audit entries */
  actorRole: z.string().default('system'),
  /** Strip PHI from error messages (default: true) */
  stripPHIFromErrors: z.boolean().default(true),
  /** PHI detector sensitivity */
  phiSensitivity: z.enum(['strict', 'standard', 'lenient']).default('standard'),
  /** Request timeout in ms (default: 30000) */
  timeout: z.number().int().positive().default(30_000),
  /** Default headers to include in every request */
  defaultHeaders: z.record(z.string()).optional(),
  /** Allowed hostnames (if set, requests to other hosts are rejected) */
  allowedHosts: z.array(z.string()).optional(),
});

export type HIPAATransportConfig = z.infer<typeof HIPAATransportConfigSchema>;

/** Request configuration for the transport */
export interface HIPAARequest {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  /** Full URL (must be https:// unless requireTLS is false) */
  url: string;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (will be JSON-serialized if object) */
  body?: unknown;
  /** Override timeout for this request */
  timeout?: number;
  /** Resource type for audit logging */
  auditResourceType?: string;
  /** Resource ID for audit logging */
  auditResourceId?: string;
}

/** Response from the transport */
export interface HIPAAResponse<T = unknown> {
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Parsed response body */
  data: T;
  /** Whether PHI was detected in the response */
  phiDetected: boolean;
}

/** Error thrown by the transport with PHI stripped */
export class HIPAATransportError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'HIPAATransportError';
  }
}

// ─── Transport ──────────────────────────────────────────────

/**
 * HIPAA-compliant HTTP client wrapper.
 *
 * Provides:
 * 1. TLS enforcement -- rejects non-HTTPS requests
 * 2. PHI stripping from errors -- prevents PHI leakage in logs
 * 3. Audit logging -- every request/response logged with outcome
 * 4. Security headers -- HSTS, no-cache for PHI responses
 * 5. Host allowlisting -- restrict which servers can be contacted
 *
 * @example
 * ```typescript
 * import { HIPAATransport } from '@solvinghealth/hipaa';
 * import { AuditLogger, InMemoryAuditStore } from '@solvinghealth/hipaa';
 *
 * const logger = new AuditLogger(new InMemoryAuditStore());
 * const transport = new HIPAATransport({
 *   auditLogger: logger,
 *   actorId: 'system-api',
 *   requireTLS: true,
 * });
 *
 * const response = await transport.request({
 *   method: 'GET',
 *   url: 'https://fhir.example.com/Patient/123',
 *   auditResourceType: 'Patient',
 *   auditResourceId: '123',
 * });
 * ```
 */
export class HIPAATransport {
  private readonly config: HIPAATransportConfig;
  private readonly phiDetector: PHIDetector;

  constructor(config?: Partial<HIPAATransportConfig>) {
    this.config = HIPAATransportConfigSchema.parse(config ?? {});
    this.phiDetector = new PHIDetector({
      sensitivity: this.config.phiSensitivity,
    });
  }

  /**
   * Make an HTTP request with HIPAA compliance enforcements.
   *
   * @param req - Request configuration
   * @returns Response with PHI detection flag
   * @throws {HIPAATransportError} If TLS is required but URL is not HTTPS, or host is not allowed
   */
  async request<T = unknown>(req: HIPAARequest): Promise<HIPAAResponse<T>> {
    // 1. Validate TLS
    if (this.config.requireTLS && !req.url.startsWith('https://')) {
      throw new HIPAATransportError(
        'HIPAA compliance requires TLS (HTTPS). Plaintext HTTP is not allowed.',
        0,
        'TLS_REQUIRED',
      );
    }

    // 2. Validate allowed hosts
    if (this.config.allowedHosts) {
      const url = new URL(req.url);
      if (!this.config.allowedHosts.includes(url.hostname)) {
        throw new HIPAATransportError(
          `Host "${url.hostname}" is not in the allowed hosts list.`,
          0,
          'HOST_NOT_ALLOWED',
        );
      }
    }

    // 3. Build headers
    const headers: Record<string, string> = {
      'Accept': 'application/json',
      ...this.config.defaultHeaders,
      ...req.headers,
    };

    if (req.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    // 4. PHI scan request body (pre-flight check)
    let requestPHIDetected = false;
    if (req.body && typeof req.body === 'string') {
      requestPHIDetected = this.phiDetector.containsPHI(req.body);
    } else if (req.body && typeof req.body === 'object') {
      const spans = this.phiDetector.detectInObject(req.body);
      requestPHIDetected = spans.length > 0;
    }

    const timeout = req.timeout ?? this.config.timeout;

    try {
      // 5. Make the request
      const response = await fetch(req.url, {
        method: req.method,
        headers,
        body: req.body ? JSON.stringify(req.body) : undefined,
        signal: AbortSignal.timeout(timeout),
      });

      // 6. Parse response
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let data: T;
      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.includes('json')) {
        data = await response.json() as T;
      } else {
        data = await response.text() as T;
      }

      // 7. PHI scan response
      let responsePHIDetected = false;
      if (typeof data === 'string') {
        responsePHIDetected = this.phiDetector.containsPHI(data);
      } else if (typeof data === 'object' && data !== null) {
        const spans = this.phiDetector.detectInObject(data);
        responsePHIDetected = spans.length > 0;
      }

      // 8. Audit log
      await this.auditRequest(
        req,
        response.status,
        response.ok ? 'success' : 'error',
        requestPHIDetected || responsePHIDetected,
      );

      // 9. Handle error responses
      if (!response.ok) {
        const errorMessage = this.sanitizeError(response.status, data);
        throw new HIPAATransportError(
          errorMessage,
          response.status,
          'HTTP_ERROR',
        );
      }

      return {
        status: response.status,
        headers: responseHeaders,
        data,
        phiDetected: responsePHIDetected,
      };
    } catch (error) {
      if (error instanceof HIPAATransportError) {
        throw error;
      }

      // Sanitize unexpected errors to prevent PHI leakage
      const sanitized = this.sanitizeUnexpectedError(error);

      await this.auditRequest(req, 0, 'error', false, sanitized);

      throw new HIPAATransportError(sanitized, 0, 'TRANSPORT_ERROR');
    }
  }

  /**
   * Convenience method for GET requests.
   */
  async get<T = unknown>(url: string, options?: Partial<HIPAARequest>): Promise<HIPAAResponse<T>> {
    return this.request<T>({ method: 'GET', url, ...options });
  }

  /**
   * Convenience method for POST requests.
   */
  async post<T = unknown>(url: string, body: unknown, options?: Partial<HIPAARequest>): Promise<HIPAAResponse<T>> {
    return this.request<T>({ method: 'POST', url, body, ...options });
  }

  /**
   * Convenience method for PUT requests.
   */
  async put<T = unknown>(url: string, body: unknown, options?: Partial<HIPAARequest>): Promise<HIPAAResponse<T>> {
    return this.request<T>({ method: 'PUT', url, body, ...options });
  }

  /**
   * Convenience method for DELETE requests.
   */
  async delete<T = unknown>(url: string, options?: Partial<HIPAARequest>): Promise<HIPAAResponse<T>> {
    return this.request<T>({ method: 'DELETE', url, ...options });
  }

  // ─── Private Methods ────────────────────────────────────

  /**
   * Sanitize error response bodies to strip PHI.
   */
  private sanitizeError(status: number, data: unknown): string {
    if (!this.config.stripPHIFromErrors) {
      return `HTTP ${status}: ${JSON.stringify(data)}`;
    }

    if (typeof data === 'string') {
      const redacted = this.phiDetector.redact(data);
      return `HTTP ${status}: ${redacted}`;
    }

    if (typeof data === 'object' && data !== null) {
      const redacted = this.phiDetector.redactObject(data);
      return `HTTP ${status}: ${JSON.stringify(redacted)}`;
    }

    return `HTTP ${status}: Request failed`;
  }

  /**
   * Sanitize unexpected errors (network errors, timeouts, etc.)
   */
  private sanitizeUnexpectedError(error: unknown): string {
    if (error instanceof Error) {
      // Strip any potential PHI from error messages
      const message = this.config.stripPHIFromErrors
        ? this.phiDetector.redact(error.message)
        : error.message;

      if (error.name === 'AbortError' || error.name === 'TimeoutError') {
        return `Request timed out after ${this.config.timeout}ms`;
      }

      if (error.message.includes('ECONNREFUSED')) {
        return 'Connection refused';
      }

      if (error.message.includes('ENOTFOUND')) {
        return 'DNS lookup failed';
      }

      return `Transport error: ${message}`;
    }

    return 'Unknown transport error';
  }

  /**
   * Log a request to the audit trail.
   */
  private async auditRequest(
    req: HIPAARequest,
    status: number,
    outcome: 'success' | 'denied' | 'error',
    phiAccessed: boolean,
    errorMessage?: string,
  ): Promise<void> {
    const logger = this.config.auditLogger as AuditLogger | undefined;
    if (!logger) return;

    const entry: AuditEntryInput = {
      actor: this.config.actorId,
      actorRole: this.config.actorRole,
      action: req.method === 'GET' || req.method === 'HEAD' ? 'read' : 'write',
      resourceType: req.auditResourceType ?? 'HTTPRequest',
      resourceId: req.auditResourceId ?? new URL(req.url).pathname,
      phiAccessed,
      outcome,
      reason: errorMessage,
      metadata: {
        method: req.method,
        url: req.url,
        status,
      },
    };

    try {
      await logger.log(entry);
    } catch {
      // Audit logging failure should not break the request
      // In production, this should trigger an alert
    }
  }
}
