import type { Decoder } from "lib0/decoding";
import type { Encoder } from "lib0/encoding";
import type { MessageType } from "./types.ts";
export declare class IncomingMessage {
    data: any;
    encoder: Encoder;
    decoder: Decoder;
    constructor(data: any);
    peekVarString(): string;
    readVarUint(): MessageType;
    readVarString(): string;
    readVarUint8Array(): Uint8Array<ArrayBufferLike>;
    writeVarUint(type: MessageType): void;
    writeVarString(string: string): void;
    writeVarUint8Array(data: Uint8Array): void;
    length(): number;
}
