import { NodeSDK } from "@opentelemetry/sdk-node"
import { LangfuseSpanProcessor } from "@langfuse/otel"

let processor: LangfuseSpanProcessor | undefined
let sdk: NodeSDK | undefined

/** True when Langfuse credentials are present in the environment. */
export function observabilityEnabled(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY)
}

/**
 * Start OpenTelemetry with the Langfuse span processor.
 *
 * No-op when credentials are absent, so the app runs unchanged without Langfuse.
 * Reads LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, and LANGFUSE_BASE_URL from the env.
 */
export function startObservability(): void {
  if (!observabilityEnabled()) {
    console.log("📡 Langfuse not configured — tracing disabled")
    return
  }
  processor = new LangfuseSpanProcessor()
  sdk = new NodeSDK({ spanProcessors: [processor] })
  sdk.start()
  console.log("📡 Langfuse tracing enabled")
}

/** Flush buffered spans and shut down the tracer. Call before process exit. */
export async function shutdownObservability(): Promise<void> {
  await processor?.forceFlush()
  await sdk?.shutdown()
}
