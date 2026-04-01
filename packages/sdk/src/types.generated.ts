// Auto-generated from http://localhost:8787/openapi.json
// Do not edit manually

export interface paths {
    "/session": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a handoff session
         * @description Creates a new handoff session routed to the user's browser extension. Returns a session URL to send to the human.
         */
        post: operations["createSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/session/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Poll session status
         * @description Poll every 3 seconds until status is ACTIVE (human connected) or a terminal state (RESOLVED, TIMEOUT, ERROR).
         */
        get: operations["getSession"];
        put?: never;
        post?: never;
        /**
         * Cancel a session
         * @description Cancel a pending or active session. Returns 409 if already resolved, 410 if already expired.
         */
        delete: operations["cancelSession"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/session/{id}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Mark session as resolved
         * @description Called by the extension when the human completes the auth challenge. Transitions session to RESOLVED.
         */
        post: operations["resolveSession"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extension/pair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Generate a pairing code
         * @description Generates a 6-character pairing code (valid for 5 minutes) for linking a browser extension to this account. Requires dashboard authentication (Clerk session).
         */
        post: operations["createPairingCode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extension/confirm-pair": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Exchange pairing code for device tokens
         * @description Extension sends the pairing code. Backend validates it, creates a device record, and returns access + refresh tokens scoped to this device.
         */
        post: operations["confirmPairing"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extension/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Refresh device access token
         * @description Exchange a valid refresh token for a new access token. Works even after the access token has expired.
         */
        post: operations["refreshDeviceToken"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/extension/device/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /**
         * Revoke a paired device
         * @description Removes a paired device. The extension will disconnect and must re-pair. Requires dashboard authentication.
         */
        delete: operations["revokeDevice"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        SessionContext: {
            /** @description URL being accessed by the agent */
            url?: string;
            /**
             * @description Type of authentication blocker
             * @enum {string}
             */
            blocker_type?: "otp" | "password" | "captcha" | "security_question" | "document_upload" | "other";
            /** @description Human-readable hint shown on session page (e.g. 'OTP sent to ****1234') */
            hint?: string;
        };
        /**
         * @description PENDING: waiting for extension. ACTIVE: human connected. RESOLVED: auth completed. TIMEOUT: session expired. ERROR: unexpected failure. CANCELLED: user cancelled.
         * @enum {string}
         */
        SessionStatus: "PENDING" | "ACTIVE" | "RESOLVED" | "TIMEOUT" | "ERROR" | "CANCELLED";
        Error: {
            error: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    createSession: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /**
                     * @description Human-readable service name shown on the session page
                     * @example HDFC NetBanking
                     */
                    service: string;
                    /**
                     * @description Session TTL in seconds (default: 600)
                     * @default 600
                     */
                    ttl?: number;
                    /** @description Optional context about the auth blocker */
                    context?: {
                        /** @description URL being accessed by the agent */
                        url?: string;
                        /**
                         * @description Type of authentication blocker
                         * @enum {string}
                         */
                        blocker_type?: "otp" | "password" | "captcha" | "security_question" | "document_upload" | "other";
                        /** @description Human-readable hint shown on session page (e.g. 'OTP sent to ****1234') */
                        hint?: string;
                    };
                };
            };
        };
        responses: {
            /** @description Session created */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Unique session identifier */
                        session_id?: string;
                        /** @description URL for the human to open and resolve the auth blocker */
                        session_url?: string;
                        /**
                         * @description Capture method — always 'extension' (browser extension handles capture)
                         * @enum {string}
                         */
                        capture?: "extension";
                        /**
                         * Format: date-time
                         * @description When the session expires
                         */
                        expires_at?: string;
                    };
                };
            };
            /** @description Invalid request body */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Invalid or missing API key */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Quota exceeded */
            402: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Browser extension not connected — user must install and pair the extension */
            412: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Rate limited */
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    getSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Session status */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        session_id?: string;
                        status?: components["schemas"]["SessionStatus"];
                        service?: string;
                        context?: components["schemas"]["SessionContext"];
                        /** Format: date-time */
                        created_at?: string;
                        /** Format: date-time */
                        expires_at?: string;
                    };
                };
            };
            /** @description Invalid API key */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session belongs to a different API key */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session expired */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    cancelSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Session cancelled */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        cancelled?: boolean;
                    };
                };
            };
            /** @description Not your session */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session already resolved */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session expired or timed out */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    resolveSession: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Session marked as resolved */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        resolved?: boolean;
                    };
                };
            };
            /** @description Invalid or missing API key */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session belongs to a different API key */
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session already in terminal state */
            409: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Session expired */
            410: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    createPairingCode: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Pairing code generated */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description 6-character pairing code (case-insensitive) */
                        code?: string;
                        /**
                         * Format: date-time
                         * @description When the code expires (5 minutes)
                         */
                        expires_at?: string;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    confirmPairing: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description 6-character pairing code from the dashboard */
                    code: string;
                };
            };
        };
        responses: {
            /** @description Device paired successfully */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description Server-generated device identifier */
                        device_id?: string;
                        /** @description Short-lived access token (1 hour) for WSS connection */
                        access_token?: string;
                        /** @description Long-lived refresh token for renewing access tokens */
                        refresh_token?: string;
                    };
                };
            };
            /** @description Invalid or expired pairing code */
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    refreshDeviceToken: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    /** @description Refresh token from pairing or previous refresh */
                    refresh_token: string;
                    /** @description Device identifier from pairing */
                    device_id: string;
                };
            };
        };
        responses: {
            /** @description Token refreshed */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        /** @description New short-lived access token (1 hour) */
                        access_token?: string;
                    };
                };
            };
            /** @description Invalid or revoked refresh token */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
    revokeDevice: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Device revoked */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        revoked?: boolean;
                    };
                };
            };
            /** @description Not authenticated */
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Device not found */
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
        };
    };
}
