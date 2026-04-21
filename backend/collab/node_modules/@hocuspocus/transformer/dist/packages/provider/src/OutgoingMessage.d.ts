import type { Encoder } from "lib0/encoding";
import type { MessageType, OutgoingMessageArguments, OutgoingMessageInterface } from "./types.ts";
export declare class OutgoingMessage implements OutgoingMessageInterface {
    encoder: Encoder;
    type?: MessageType;
    constructor();
    get(args: Partial<OutgoingMessageArguments>): Encoder | undefined;
    toUint8Array(): Uint8Array<ArrayBufferLike>;
}
