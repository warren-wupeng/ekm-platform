import type { Server as HTTPServer, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import type { AddressInfo, ServerOptions } from "ws";
import { Hocuspocus } from "./Hocuspocus.ts";
import type { Configuration } from "./types.ts";
export interface ServerConfiguration extends Configuration {
    port?: number;
    address?: string;
    stopOnSignals?: boolean;
}
export declare const defaultServerConfiguration: {
    port: number;
    address: string;
    stopOnSignals: boolean;
};
export declare class Server {
    httpServer: HTTPServer;
    webSocketServer: WebSocketServer;
    hocuspocus: Hocuspocus;
    configuration: ServerConfiguration;
    constructor(configuration?: Partial<ServerConfiguration>, websocketOptions?: ServerOptions);
    setupWebsocketConnection: () => void;
    setupHttpUpgrade: () => void;
    requestHandler: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
    listen(port?: number, callback?: any): Promise<Hocuspocus>;
    get address(): AddressInfo;
    destroy(): Promise<any>;
    get URL(): string;
    get webSocketURL(): string;
    get httpURL(): string;
    private showStartScreen;
}
