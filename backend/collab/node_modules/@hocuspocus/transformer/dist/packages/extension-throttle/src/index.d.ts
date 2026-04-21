import type { Extension, onConnectPayload } from "@hocuspocus/server";
export interface ThrottleConfiguration {
    throttle: number | null | false;
    consideredSeconds: number;
    banTime: number;
    cleanupInterval: number;
}
export declare class Throttle implements Extension {
    configuration: ThrottleConfiguration;
    connectionsByIp: Map<string, Array<number>>;
    bannedIps: Map<string, number>;
    cleanupInterval?: NodeJS.Timeout;
    /**
     * Constructor
     */
    constructor(configuration?: Partial<ThrottleConfiguration>);
    onDestroy(): Promise<void>;
    clearMaps(): void;
    isBanned(ip: string): boolean;
    /**
     * Throttle requests
     * @private
     */
    private throttle;
    /**
     * onConnect hook
     * @param data
     */
    onConnect(data: onConnectPayload): Promise<any>;
}
