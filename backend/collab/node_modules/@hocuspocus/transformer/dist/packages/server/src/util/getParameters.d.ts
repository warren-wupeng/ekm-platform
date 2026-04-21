import type { IncomingMessage } from "node:http";
import { URLSearchParams } from "node:url";
/**
 * Get parameters by the given request
 */
export declare function getParameters(request?: Pick<IncomingMessage, "url">): URLSearchParams;
