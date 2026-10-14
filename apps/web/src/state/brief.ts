import { createDailyBriefEnvironmentAtoms } from "@t3tools/client-runtime/state/brief";

import { connectionAtomRuntime } from "../connection/runtime";

export const dailyBriefEnvironment = createDailyBriefEnvironmentAtoms(connectionAtomRuntime);
