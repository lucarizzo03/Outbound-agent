import "dotenv/config";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import { AnthropicInstrumentation } from "@arizeai/openinference-instrumentation-anthropic";
import Anthropic from "@anthropic-ai/sdk";

const anthropicInstrumentation = new AnthropicInstrumentation();
anthropicInstrumentation.manuallyInstrument(Anthropic);

export const sdk = new NodeSDK({
  spanProcessors: [new LangfuseSpanProcessor()],
  instrumentations: [anthropicInstrumentation],
});

sdk.start();
