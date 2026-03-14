// Auto-generated from https://api.authloop.ai/openapi.json
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
         * @description Creates a new handoff session. Returns a session URL to send to the human and a stream token for the agent to publish browser frames.
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
         * @description Called by the agent before disconnecting from the stream. Signals that the auth blocker was successfully resolved. Must be called before disconnecting to distinguish a successful resolution from an unexpected disconnect.
         */
        post: operations["resolveSession"];
        delete?: never;
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
         * @description PENDING: waiting for human. ACTIVE: human connected. RESOLVED: auth completed. TIMEOUT: session expired. ERROR: unexpected failure.
         * @enum {string}
         */
        SessionStatus: "PENDING" | "ACTIVE" | "RESOLVED" | "TIMEOUT" | "ERROR";
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
                     * Format: uri
                     * @description CDP WebSocket URL for browser screencast capture
                     */
                    cdp_url: string;
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
                        /** @description Token for the agent to publish browser frames to the session */
                        stream_token?: string;
                        /** @description WebSocket URL for connecting to the streaming server */
                        stream_url?: string;
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
}
