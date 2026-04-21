import type { HocuspocusProvider } from "./HocuspocusProvider.ts";
import type { IncomingMessage } from "./IncomingMessage.ts";
export declare class MessageReceiver {
    message: IncomingMessage;
    constructor(message: IncomingMessage);
    apply(provider: HocuspocusProvider, emitSynced: boolean): void;
    private applySyncMessage;
    applySyncStatusMessage(provider: HocuspocusProvider, applied: boolean): void;
    private applyAwarenessMessage;
    private applyAuthMessage;
    private applyQueryAwarenessMessage;
}
