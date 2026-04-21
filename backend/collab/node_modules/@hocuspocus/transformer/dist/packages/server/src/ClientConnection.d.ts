import type { IncomingMessage } from "node:http";
import { type CloseEvent } from "@hocuspocus/common";
import type WebSocket from "ws";
import type Document from "./Document.ts";
import type { Hocuspocus } from "./Hocuspocus.ts";
import type { onDisconnectPayload } from "./types.ts";
/**
 * The `ClientConnection` class is responsible for handling an incoming WebSocket
 *
 * TODO-refactor:
 * - use event handlers instead of calling hooks directly, hooks should probably be called from Hocuspocus.ts
 */
export declare class ClientConnection {
    private readonly websocket;
    private readonly request;
    private readonly documentProvider;
    private readonly hooks;
    private readonly opts;
    private readonly defaultContext;
    private readonly documentConnections;
    private readonly incomingMessageQueue;
    private readonly documentConnectionsEstablished;
    private readonly hookPayloads;
    private readonly callbacks;
    private readonly socketId;
    timeout: number;
    pingInterval: NodeJS.Timeout;
    pongReceived: boolean;
    /**
     * The `ClientConnection` class receives incoming WebSocket connections,
     * runs all hooks:
     *
     *  - onConnect for all connections
     *  - onAuthenticate only if required
     *
     * … and if nothings fails it’ll fully establish the connection and
     * load the Document then.
     */
    constructor(websocket: WebSocket, request: IncomingMessage, documentProvider: {
        createDocument: Hocuspocus["createDocument"];
    }, hooks: Hocuspocus["hooks"], opts: {
        timeout: number;
    }, defaultContext?: any);
    private handleWebsocketClose;
    close(event?: CloseEvent): void;
    handlePong: () => void;
    /**
     * Check if pong was received and close the connection otherwise
     * @private
     */
    private check;
    /**
     * Set a callback that will be triggered when the connection is closed
     */
    onClose(callback: (document: Document, payload: onDisconnectPayload) => void): ClientConnection;
    /**
     * Create a new connection by the given request and document
     */
    private createConnection;
    private setUpNewConnection;
    private handleQueueingMessage;
    private messageHandler;
}
