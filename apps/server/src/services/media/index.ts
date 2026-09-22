import { DisabledMediaProvider, type MediaProvider } from "./MediaProvider.js";
import { LiveKitProvider } from "./LiveKitProvider.js";

export * from "./MediaProvider.js";
export { LiveKitProvider } from "./LiveKitProvider.js";

export interface MediaEnv {
  MEDIA_PROVIDER?: string;
  LIVEKIT_URL?: string;
  LIVEKIT_API_KEY?: string;
  LIVEKIT_API_SECRET?: string;
}

/**
 * No provider unless one is named. A deployment without media keys runs the
 * card game exactly as before, with the call controls hidden.
 */
export function createMediaProvider(env: MediaEnv): MediaProvider {
  switch ((env.MEDIA_PROVIDER ?? "none").toLowerCase()) {
    case "":
    case "none":
      return new DisabledMediaProvider();
    case "livekit":
      return new LiveKitProvider({
        url: env.LIVEKIT_URL ?? "",
        apiKey: env.LIVEKIT_API_KEY ?? "",
        apiSecret: env.LIVEKIT_API_SECRET ?? "",
      });
    default:
      throw new Error(
        `Unknown MEDIA_PROVIDER "${env.MEDIA_PROVIDER}". Use "livekit" or "none".`,
      );
  }
}
