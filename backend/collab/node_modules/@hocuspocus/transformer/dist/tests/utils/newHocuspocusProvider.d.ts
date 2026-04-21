import { HocuspocusProvider, type HocuspocusProviderConfiguration, type HocuspocusProviderWebsocket, type HocuspocusProviderWebsocketConfiguration } from '@hocuspocus/provider';
import type { Hocuspocus } from '@hocuspocus/server';
export declare const newHocuspocusProvider: (server: Hocuspocus, options?: Partial<HocuspocusProviderConfiguration>, websocketOptions?: Partial<HocuspocusProviderWebsocketConfiguration>, websocketProvider?: HocuspocusProviderWebsocket) => HocuspocusProvider;
