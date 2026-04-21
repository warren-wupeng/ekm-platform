import type { Encoder } from "lib0/encoding";
import type { ConstructableOutgoingMessage } from "./types.ts";
export declare class MessageSender {
    encoder: Encoder;
    message: any;
    constructor(Message: ConstructableOutgoingMessage, args?: any);
    create(): Uint8Array<ArrayBufferLike>;
    send(webSocket: any): void;
}
