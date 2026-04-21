import type { DatabaseConfiguration } from "@hocuspocus/extension-database";
import { Database } from "@hocuspocus/extension-database";
import { S3Client } from "@aws-sdk/client-s3";
export interface S3Configuration extends DatabaseConfiguration {
    /**
     * AWS S3 region
     */
    region?: string;
    /**
     * S3 bucket name
     */
    bucket: string;
    /**
     * S3 key prefix for documents (optional)
     */
    prefix?: string;
    /**
     * AWS credentials
     */
    credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
    };
    /**
     * S3 endpoint URL (for S3-compatible services like MinIO)
     */
    endpoint?: string;
    /**
     * Force path style URLs (required for MinIO)
     */
    forcePathStyle?: boolean;
    /**
     * Custom S3 client
     */
    s3Client?: S3Client;
}
export declare class S3 extends Database {
    private s3Client?;
    configuration: S3Configuration;
    constructor(configuration: Partial<S3Configuration>);
    private getObjectKey;
    onConfigure(): Promise<void>;
    onListen(): Promise<void>;
}
