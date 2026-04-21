import type Document from "./Document.ts";
import type { Hocuspocus } from "./Hocuspocus.ts";
import type { DirectConnection as DirectConnectionInterface } from "./types.ts";
export declare class DirectConnection implements DirectConnectionInterface {
    document: Document | null;
    instance: Hocuspocus;
    context: any;
    /**
     * Constructor.
     */
    constructor(document: Document, instance: Hocuspocus, context?: any);
    transact(transaction: (document: Document) => void): Promise<void>;
    disconnect(): Promise<void>;
}
