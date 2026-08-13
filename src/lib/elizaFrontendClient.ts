/**
 * ELIZA Frontend Client
 * TypeScript client for calling ELIZA Intelligence Layer from React
 * Handles authentication, token management, and API calls
 */

import { ElizaIntelligenceRequest, ElizaIntelligenceResponse } from "../types/eliza-intelligence";

// ============================================================================
// TYPES
// ============================================================================

export interface AuthCredentials {
  firebaseUid: string;
  clinicId: string;
}

export interface AuthResponse {
  token: string;
  userId: string;
  clinicId: string;
  role: string;
  expiresIn: number;
}

export interface CurrentUser {
  userId: string;
  clinicId: string;
  role: string;
  permissions: string[];
  userInfo: any;
}

export interface ElizaClientOptions {
  baseUrl?: string;
  tokenStorageKey?: string;
  onTokenExpired?: () => void;
}

// ============================================================================
// CLIENT IMPLEMENTATION
// ============================================================================

export class ElizaFrontendClient {
  private baseUrl: string;
  private tokenStorageKey: string;
  private token: string | null = null;
  private refreshTimeout: NodeJS.Timeout | null = null;
  private onTokenExpired: (() => void) | null = null;

  constructor(options: ElizaClientOptions = {}) {
    this.baseUrl = options.baseUrl || "/api";
    this.tokenStorageKey = options.tokenStorageKey || "eliza_token";
    this.onTokenExpired = options.onTokenExpired || null;

    // Try to load token from storage
    this.loadToken();

    // Setup token refresh
    if (this.token) {
      this.scheduleTokenRefresh();
    }
  }

  // ========================================================================
  // AUTHENTICATION
  // ========================================================================

  /**
   * Login with Firebase UID and clinic ID
   */
  async login(credentials: AuthCredentials): Promise<AuthResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Login failed");
      }

      const { data } = await response.json();
      this.setToken(data.token);
      this.scheduleTokenRefresh();
      return data;
    } catch (err: any) {
      console.error("[ELIZA_LOGIN_ERROR]", err);
      throw err;
    }
  }

  /**
   * Refresh current token
   */
  async refreshToken(): Promise<string> {
    try {
      if (!this.token) {
        throw new Error("No token to refresh");
      }

      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (!response.ok) {
        this.clearToken();
        if (this.onTokenExpired) {
          this.onTokenExpired();
        }
        throw new Error("Token refresh failed");
      }

      const { data } = await response.json();
      this.setToken(data.token);
      this.scheduleTokenRefresh();
      return data.token;
    } catch (err: any) {
      console.error("[ELIZA_REFRESH_ERROR]", err);
      throw err;
    }
  }

  /**
   * Get current authenticated user
   */
  async getCurrentUser(): Promise<CurrentUser> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/me`, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error("Failed to get current user");
      }

      const { data } = await response.json();
      return data;
    } catch (err: any) {
      console.error("[ELIZA_GET_USER_ERROR]", err);
      throw err;
    }
  }

  /**
   * Get all clinics user is member of
   */
  async getUserClinics() {
    try {
      const response = await fetch(`${this.baseUrl}/auth/clinics`, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error("Failed to get clinics");
      }

      const { data } = await response.json();
      return data;
    } catch (err: any) {
      console.error("[ELIZA_GET_CLINICS_ERROR]", err);
      throw err;
    }
  }

  /**
   * Logout
   */
  async logout(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/auth/logout`, {
        method: "POST",
        headers: this.getAuthHeaders(),
      });
    } catch (err) {
      console.warn("Logout request failed (will clear token anyway)", err);
    } finally {
      this.clearToken();
    }
  }

  // ========================================================================
  // INTELLIGENCE API
  // ========================================================================

  /**
   * Analyze with ELIZA Intelligence Layer
   */
  async analyze(request: ElizaIntelligenceRequest): Promise<ElizaIntelligenceResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/intelligence/analyze`, {
        method: "POST",
        headers: {
          ...this.getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error?.message || "Analysis failed");
      }

      return await response.json();
    } catch (err: any) {
      console.error("[ELIZA_ANALYZE_ERROR]", err);
      throw err;
    }
  }

  /**
   * Get available tools
   */
  async getAvailableTools() {
    try {
      const response = await fetch(`${this.baseUrl}/intelligence/tools`, {
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        throw new Error("Failed to get tools");
      }

      const { data } = await response.json();
      return data.tools;
    } catch (err: any) {
      console.error("[ELIZA_GET_TOOLS_ERROR]", err);
      throw err;
    }
  }

  /**
   * Approve an action
   */
  async approveAction(actionId: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/intelligence/approve-action`, {
        method: "POST",
        headers: {
          ...this.getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ actionId }),
      });

      if (!response.ok) {
        throw new Error("Failed to approve action");
      }

      const { data } = await response.json();
      return data;
    } catch (err: any) {
      console.error("[ELIZA_APPROVE_ACTION_ERROR]", err);
      throw err;
    }
  }

  // ========================================================================
  // HELPERS
  // ========================================================================

  /**
   * Check if user is authenticated
   */
  isAuthenticated(): boolean {
    return this.token !== null;
  }

  /**
   * Get current token
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * Set token and save to storage
   */
  private setToken(token: string): void {
    this.token = token;
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(this.tokenStorageKey, token);
    }
  }

  /**
   * Load token from storage
   */
  private loadToken(): void {
    if (typeof window !== "undefined" && window.localStorage) {
      const stored = window.localStorage.getItem(this.tokenStorageKey);
      if (stored) {
        this.token = stored;
      }
    }
  }

  /**
   * Clear token
   */
  private clearToken(): void {
    this.token = null;
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(this.tokenStorageKey);
    }
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }

  /**
   * Get authorization headers
   */
  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    return headers;
  }

  /**
   * Schedule automatic token refresh
   * Refreshes 5 minutes before expiry
   */
  private scheduleTokenRefresh(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    // JWT expiry is 5 hours (18000 seconds)
    // Refresh after 4 hours 55 minutes (17700 seconds)
    const refreshIn = 17700 * 1000; // milliseconds

    this.refreshTimeout = setTimeout(() => {
      this.refreshToken().catch((err) => {
        console.error("Auto-refresh failed:", err);
        if (this.onTokenExpired) {
          this.onTokenExpired();
        }
      });
    }, refreshIn);
  }
}

// ============================================================================
// SINGLETON INSTANCE (for easy import)
// ============================================================================

let clientInstance: ElizaFrontendClient | null = null;

export function initializeElizaClient(options?: ElizaClientOptions): ElizaFrontendClient {
  clientInstance = new ElizaFrontendClient(options);
  return clientInstance;
}

export function getElizaClient(): ElizaFrontendClient {
  if (!clientInstance) {
    clientInstance = new ElizaFrontendClient();
  }
  return clientInstance;
}
