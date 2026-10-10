import * as Schema from "effect/Schema";

export const AUTO_MODEL_ROUTING_LEARNING_KEY = "naowee:auto-model-routing:learned-v1";

export const LearnedRoutingTermsSchema = Schema.Record(Schema.String, Schema.Number);

export const EMPTY_LEARNED_ROUTING_TERMS: typeof LearnedRoutingTermsSchema.Type = {};
