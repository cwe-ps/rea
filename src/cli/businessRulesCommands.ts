import { z } from "incur";
import { resolve } from "node:path";

import { createBusinessRulesArtifactService } from "../composition/businessRules.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";

/** Inspect operator-selected BR artifacts through the same shared workflow as MCP. */
export const registerBusinessRulesCommands = (
  cli: CliInstance,
  logger: Logger,
): void => {
  const service = createBusinessRulesArtifactService();
  cli.command(CLI_COMMANDS.inspectBusinessRulesArtifact, {
    description:
      "Inspect a Business Rules! artifact (.WB, .brs/.wbs, .prc, ST-FILE, SCREEN, WBCONFIG) without executing it",
    args: z.object({
      path: z.string().describe("Local Business Rules! artifact"),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(
          logger,
          CLI_COMMANDS.inspectBusinessRulesArtifact,
          async () => {
            const result = await service.inspect(
              { path: resolve(args.path) },
              { signal },
            );
            return result.ok
              ? result.value
              : projectAnalysisError(result.error);
          },
        ),
      ),
  });
};
