import type { Decoder } from "lib0/decoding";
import type { Encoder } from "lib0/encoding";
import type { MessageType } from "./types.ts";
export declare class IncomingMessage {
    /**
     * Access to the received message.
     */
    decoder: Decoder;
    /**
     * Private encoder; can be undefined.
     *
     * Lazy creation of the encoder speeds up IncomingMessages that need only a decoder.
     */
    private encoderInternal?;
    constructor(input: any);
    get encoder(): Encoder;
    readVarUint8Array(): Uint8Array<ArrayBufferLike>;
    peekVarUint8Array(): Uint8Array<ArrayBufferLike>;
    readVarUint(): number;
    readVarString(): string;
    toUint8Array(): Uint8Array<ArrayBufferLike>;
    writeVarUint(type: MessageType): void;
    writeVarString(string: string): void;
    get length(): number;
}
