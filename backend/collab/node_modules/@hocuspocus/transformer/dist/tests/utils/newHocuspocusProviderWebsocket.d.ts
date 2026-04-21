import type { HocuspocusProviderWebsocketConfiguration } from '@hocuspocus/provider';
import { HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import type { Hocuspocus } from '@hocuspocus/server';
export declare const newHocuspocusProviderWebsocket: (hocuspocus: Hocuspocus, options?: Partial<Omit<HocuspocusProviderWebsocketConfiguration, "url">>) => HocuspocusProviderWebsocket;
